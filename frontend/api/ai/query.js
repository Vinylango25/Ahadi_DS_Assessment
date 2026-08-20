// Vercel Serverless Function: POST /api/ai/query
// Body: { question: string }
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'qwen/qwen3.6-27b';

function stripThinkTags(text) {
  return (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function loadPopulationData() {
  const candidates = [
    path.join(__dirname, '../population.json'),
    path.join(__dirname, '../../dist/browser/population.json'),
    path.join(process.cwd(), 'dist/browser/population.json'),
    path.join(process.cwd(), 'population.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* skip */ }
  }
  return null;
}

function getRecords(bundle) {
  return Object.values(bundle?.county_summaries || {});
}

function callGroq(systemPrompt, userPrompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.1,
      max_tokens:  maxTokens || 400,
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          resolve(stripThinkTags(json.choices[0].message.content));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const QUERY_SYSTEM = `You are a data analyst for Kenya population data. The user asks a question about Kenya counties.
Respond with ONLY a JSON object — no explanation, no markdown.

Available fields on each record:
  county, year, total_population, children_under_5, working_age, elderly_65plus,
  sex_ratio, dependency_ratio, child_dependency_ratio, elderly_dependency_ratio,
  pct_children, pct_elderly, county_area_km2

JSON shape:
{
  "filter_year": <number or null>,
  "filter_county": <string or null>,
  "sort_by": <field name or null>,
  "sort_dir": "asc" | "desc",
  "limit": <number 1-50>,
  "aggregate": "sum" | "avg" | "max" | "min" | null,
  "aggregate_field": <field name or null>,
  "filter_field": <field name or null>,
  "filter_op": "gt" | "lt" | "eq" | null,
  "filter_value": <number or null>,
  "intent": <one sentence>
}`;

function executeQuery(records, plan) {
  let rows = [...records];

  if (plan.filter_year)   rows = rows.filter(r => r.year === plan.filter_year);
  if (plan.filter_county) rows = rows.filter(r => r.county?.toLowerCase().includes(plan.filter_county.toLowerCase()));

  // Field filter (e.g. sex_ratio > 105)
  if (plan.filter_field && plan.filter_op && plan.filter_value != null) {
    rows = rows.filter(r => {
      const v = r[plan.filter_field];
      if (v == null) return false;
      if (plan.filter_op === 'gt') return v > plan.filter_value;
      if (plan.filter_op === 'lt') return v < plan.filter_value;
      if (plan.filter_op === 'eq') return v === plan.filter_value;
      return true;
    });
  }

  // Aggregate
  if (plan.aggregate && plan.aggregate_field) {
    const field = plan.aggregate_field;
    const vals  = rows.map(r => r[field]).filter(v => v != null && isFinite(v));
    if (!vals.length) return [];
    let value;
    switch (plan.aggregate) {
      case 'sum': value = vals.reduce((a, b) => a + b, 0); break;
      case 'avg': value = vals.reduce((a, b) => a + b, 0) / vals.length; break;
      case 'max': value = Math.max(...vals); break;
      case 'min': value = Math.min(...vals); break;
    }
    return [{ result: value, field, year: plan.filter_year || 'all', counties: rows.length }];
  }

  // Sort
  if (plan.sort_by) {
    const dir = plan.sort_dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => ((a[plan.sort_by] || 0) - (b[plan.sort_by] || 0)) * dir);
  }

  const limit = Math.min(plan.limit || 10, 50);
  const displayField = plan.sort_by || plan.filter_field || 'total_population';
  return rows.slice(0, limit).map(r => ({
    county: r.county,
    year:   r.year,
    [displayField]: r[displayField],
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ detail: 'Method not allowed' }); return; }

  const question = (req.body?.question || '').trim();
  if (!question) { res.status(400).json({ detail: 'question is required' }); return; }

  if (!GROQ_API_KEY) {
    res.status(200).json({ question, sql: null, results: [], answer: 'AI query requires GROQ_API_KEY.', error: null });
    return;
  }

  const bundle  = loadPopulationData();
  const records = getRecords(bundle);

  try {
    // Step 1: query plan
    const planRaw = await callGroq(QUERY_SYSTEM, question, 300);
    let plan;
    try {
      const cleaned = planRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch {
      res.status(200).json({ question, sql: null, results: [], answer: 'Could not parse your question. Try rephrasing.', error: 'parse error' });
      return;
    }

    // Step 2: execute
    const results = executeQuery(records, plan);

    if (!results.length) {
      res.status(200).json({ question, sql: `/* ${plan.intent} */`, results: [], answer: 'No records found.', error: null });
      return;
    }

    // Step 3: plain-English answer
    const ANSWER_SYS = `You are a data analyst. Given query results about Kenya's population, answer in 1-3 clear sentences. Be specific with numbers.`;
    const ANSWER_USER = `Question: ${question}\nResults: ${JSON.stringify(results.slice(0, 5))}`;
    const answer = await callGroq(ANSWER_SYS, ANSWER_USER, 200);

    res.status(200).json({ question, sql: `/* ${plan.intent} */`, results, answer, error: null });

  } catch (err) {
    res.status(200).json({ question, sql: null, results: [], answer: null, error: err.message });
  }
};
