// Vercel Serverless Function: POST /api/ai/query
// Body: { question: string }
// Translates natural language questions into structured queries over population.json data.
// No SQLite on Vercel — we run the query logic in JS against the in-memory JSON bundle.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'qwen/qwen3.6-27b';

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

/** Flatten county_summaries into a flat array of records */
function getRecords(bundle) {
  return Object.values(bundle?.county_summaries || {});
}

function callGroq(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.1,
      max_tokens:  500,
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || 'Groq error'));
          resolve(json.choices[0].message.content.trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const QUERY_SYSTEM = `You are a data analyst for Kenya population data. The user asks a question about Kenya counties.
You must respond with a JSON object (and nothing else) describing how to query the data.

Available fields on each record:
  county, year, total_population, children_under_5, working_age, elderly_65plus,
  sex_ratio, dependency_ratio, child_dependency_ratio, elderly_dependency_ratio,
  pct_children, pct_elderly, county_area_km2

Your JSON response must have this exact shape:
{
  "filter_year": <number or null>,
  "filter_county": <string or null>,
  "sort_by": <field name or null>,
  "sort_dir": "asc" | "desc",
  "limit": <number, default 10>,
  "aggregate": "sum" | "avg" | "max" | "min" | null,
  "aggregate_field": <field name or null>,
  "intent": <one sentence describing what you're computing>
}

Examples:
- "Which county has the highest dependency ratio in 2025?" → { "filter_year": 2025, "sort_by": "dependency_ratio", "sort_dir": "desc", "limit": 1, "aggregate": null, "intent": "Find county with highest dependency ratio in 2025" }
- "Top 5 most populous counties in 2024" → { "filter_year": 2024, "sort_by": "total_population", "sort_dir": "desc", "limit": 5, "aggregate": null, "intent": "Top 5 by population in 2024" }
- "Average children under 5 across all counties in 2025" → { "filter_year": 2025, "aggregate": "avg", "aggregate_field": "children_under_5", "intent": "Average children under 5 in 2025" }

Respond ONLY with the JSON object. No explanation.`;

function executeQuery(records, plan) {
  let rows = [...records];

  // Filter by year
  if (plan.filter_year) {
    rows = rows.filter(r => r.year === plan.filter_year);
  }

  // Filter by county
  if (plan.filter_county) {
    const county = plan.filter_county.toLowerCase();
    rows = rows.filter(r => r.county?.toLowerCase().includes(county));
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
    return [{ [field]: value, year: plan.filter_year || 'all', counties: rows.length }];
  }

  // Sort
  if (plan.sort_by) {
    const dir = plan.sort_dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => ((a[plan.sort_by] || 0) - (b[plan.sort_by] || 0)) * dir);
  }

  // Limit
  const limit = Math.min(plan.limit || 10, 50);
  return rows.slice(0, limit).map(r => ({
    county:           r.county,
    year:             r.year,
    [plan.sort_by || 'total_population']: r[plan.sort_by || 'total_population'],
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ detail: 'Method not allowed' }); return; }

  const question = (req.body?.question || '').trim();
  if (!question) {
    res.status(400).json({ detail: 'question is required' });
    return;
  }

  if (!GROQ_API_KEY) {
    res.status(200).json({
      question, sql: null, results: [],
      answer: 'AI query requires GROQ_API_KEY to be configured.',
      error: null,
    });
    return;
  }

  const bundle  = loadPopulationData();
  const records = getRecords(bundle);

  try {
    // Step 1: Get query plan from LLM
    const planRaw = await callGroq(QUERY_SYSTEM, question);
    let plan;
    try {
      const cleaned = planRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch {
      res.status(200).json({
        question, sql: null, results: [],
        answer: 'I had trouble understanding that question. Please try rephrasing.',
        error: 'Failed to parse query plan',
      });
      return;
    }

    // Step 2: Execute against in-memory data
    const results = executeQuery(records, plan);

    if (!results.length) {
      res.status(200).json({
        question, sql: `/* ${plan.intent} */`, results: [],
        answer: 'No records found matching your query.',
        error: null,
      });
      return;
    }

    // Step 3: Generate natural language answer
    const ANSWER_SYSTEM = `You are a data analyst. Given query results about Kenya's population data,
provide a clear, concise plain English answer in 1-3 sentences. Be specific with numbers. Use commas for thousands.`;

    const ANSWER_USER = `Question: ${question}

Results (first 5 rows):
${JSON.stringify(results.slice(0, 5), null, 2)}

Answer the question in plain English.`;

    const answer = await callGroq(ANSWER_SYSTEM, ANSWER_USER);

    res.status(200).json({
      question,
      sql:     `/* ${plan.intent} — executed against population.json */`,
      results,
      answer,
      error:   null,
    });
  } catch (err) {
    res.status(200).json({
      question, sql: null, results: [],
      answer: null,
      error:  err.message || 'Query failed',
    });
  }
};

