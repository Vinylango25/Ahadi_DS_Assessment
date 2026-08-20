// Vercel Serverless Function: POST /api/ai/query
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'qwen/qwen3.6-27b';

/** Strip <think>...</think> blocks and any unclosed <think> to end */
function stripThinkTags(text) {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .trim();
}

/** Extract the first {...} JSON object from a string, ignoring surrounding text */
function extractJSON(text) {
  const clean = stripThinkTags(text);
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.substring(start, end + 1)); } catch { return null; }
}

function loadPopulationData() {
  const candidates = [
    path.join(__dirname, '../population.json'),
    path.join(__dirname, '../../dist/browser/population.json'),
    path.join(process.cwd(), 'dist/browser/population.json'),
    path.join(process.cwd(), 'population.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* skip */ }
  }
  return null;
}

function callGroq(systemPrompt, userPrompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:            GROQ_MODEL,
      messages:         [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature:      0.1,
      max_tokens:       maxTokens || 400,
      reasoning_effort: 'none',
    });
    const req = https.request({
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          resolve(json.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const QUERY_SYSTEM = `You are a data analyst for Kenya population data.
Return ONLY a raw JSON object (no markdown, no explanation, no thinking).

Available fields: county, year, total_population, children_under_5, working_age, elderly_65plus, sex_ratio, dependency_ratio, pct_children, pct_elderly, county_area_km2

JSON schema:
{
  "filter_year": number | null,
  "filter_county": string | null,
  "sort_by": string | null,
  "sort_dir": "asc" | "desc",
  "limit": number,
  "aggregate": "sum" | "avg" | "max" | "min" | null,
  "aggregate_field": string | null,
  "filter_field": string | null,
  "filter_op": "gt" | "lt" | "eq" | null,
  "filter_value": number | null,
  "intent": string
}`;

function executeQuery(records, plan) {
  let rows = [...records];
  if (plan.filter_year)   rows = rows.filter(r => r.year === plan.filter_year);
  if (plan.filter_county) rows = rows.filter(r => r.county?.toLowerCase().includes(plan.filter_county.toLowerCase()));
  if (plan.filter_field && plan.filter_op && plan.filter_value != null) {
    rows = rows.filter(r => {
      const v = r[plan.filter_field]; if (v == null) return false;
      if (plan.filter_op === 'gt') return v > plan.filter_value;
      if (plan.filter_op === 'lt') return v < plan.filter_value;
      return v === plan.filter_value;
    });
  }
  if (plan.aggregate && plan.aggregate_field) {
    const vals = rows.map(r => r[plan.aggregate_field]).filter(v => v != null && isFinite(v));
    if (!vals.length) return [];
    const agg = {
      sum: vals.reduce((a,b)=>a+b,0),
      avg: vals.reduce((a,b)=>a+b,0)/vals.length,
      max: Math.max(...vals),
      min: Math.min(...vals),
    }[plan.aggregate];
    return [{ result: +agg.toFixed(2), field: plan.aggregate_field, year: plan.filter_year||'all', counties: rows.length }];
  }
  if (plan.sort_by) {
    const dir = plan.sort_dir === 'asc' ? 1 : -1;
    rows.sort((a,b) => ((a[plan.sort_by]||0)-(b[plan.sort_by]||0))*dir);
  }
  const limit = Math.min(plan.limit||10, 50);
  const field = plan.sort_by || plan.filter_field || 'total_population';
  return rows.slice(0, limit).map(r => ({ county: r.county, year: r.year, [field]: r[field] }));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ detail: 'Method not allowed' }); return; }

  const question = (req.body?.question || '').trim();
  if (!question) { res.status(400).json({ detail: 'question is required' }); return; }
  if (!GROQ_API_KEY) {
    res.status(200).json({ question, sql: null, results: [], answer: 'AI query requires GROQ_API_KEY.', error: null });
    return;
  }

  const bundle  = loadPopulationData();
  const records = Object.values(bundle?.county_summaries || {});

  try {
    // Step 1: get query plan — extract JSON robustly
    const planRaw = await callGroq(QUERY_SYSTEM, question, 400);
    const plan    = extractJSON(planRaw);

    if (!plan) {
      res.status(200).json({ question, sql: null, results: [], answer: 'I could not understand that question. Please try rephrasing it.', error: null });
      return;
    }

    // Step 2: execute against in-memory data
    const results = executeQuery(records, plan);

    if (!results.length) {
      res.status(200).json({ question, sql: `/* ${plan.intent} */`, results: [], answer: 'No records matched your query.', error: null });
      return;
    }

    // Step 3: plain-English answer
    const ANSWER_SYS = `You are a Kenya population data analyst. Answer the user's question in 2-3 clear, specific sentences using the data provided. Use commas for thousands. No markdown.`;
    const ANSWER_USER = `Question: ${question}\nData: ${JSON.stringify(results.slice(0,10))}`;
    const rawAnswer   = await callGroq(ANSWER_SYS, ANSWER_USER, 200);
    const answer      = stripThinkTags(rawAnswer);

    res.status(200).json({ question, sql: `/* ${plan.intent} */`, results, answer, error: null });
  } catch (err) {
    res.status(200).json({ question, sql: null, results: [], answer: null, error: err.message });
  }
};
