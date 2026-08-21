// Vercel Serverless Function: POST /api/ai/query
// Comprehensive NL query over Kenya population data
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'qwen/qwen3.6-27b';

function stripThinkTags(text) {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '').trim();
}

function extractJSON(text) {
  const clean = stripThinkTags(text).replace(/\*\*/g, '');
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
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return null;
}

function callGroq(system, user, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.1,
      max_tokens: maxTokens || 500,
      reasoning_effort: 'none',
    });
    const req = https.request({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message)); resolve(j.choices[0].message.content); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── Available fields description ──────────────────────────────
const FIELDS_DESC = `
Each record has: county (string), year (2021-2025), total_population, children_under_5,
working_age, elderly_65plus, sex_ratio (males per 100 females), dependency_ratio,
child_dependency_ratio, elderly_dependency_ratio, pct_children (%), pct_elderly (%),
county_area_km2
`;

const QUERY_SYSTEM = `You are a data analyst for Kenya county population data (2021-2025).
${FIELDS_DESC}
Return ONLY a raw JSON object — no markdown, no explanation, no <think> tags.

JSON schema:
{
  "filter_year": number | null,
  "filter_county": string | null,
  "sort_by": string | null,
  "sort_dir": "asc" | "desc",
  "limit": number,
  "aggregate": "sum" | "avg" | "max" | "min" | "count" | null,
  "aggregate_field": string | null,
  "filters": [{"field": string, "op": "gt"|"lt"|"eq"|"gte"|"lte", "value": number}],
  "group_by_county": boolean,
  "intent": string
}

CRITICAL RULES:
- "bottom N" / "lowest N" / "least" = sort_dir "asc", limit N — ALWAYS filter_year 2025 if no year given
- "top N" / "highest N" / "most" = sort_dir "desc", limit N — ALWAYS filter_year 2025 if no year given
- "all counties" ranking questions MUST set filter_year to 2025 (or stated year)
- "where X exceeds/above/over Y" = filters: [{field: X, op: "gt", value: Y}]
- "where X below/under Y" = filters: [{field: X, op: "lt", value: Y}]
- "average/mean" = aggregate "avg" on the relevant field
- "total" national = aggregate "sum"
- "how many counties" = aggregate "count"
- "compare X and Y counties" = filter_county with first county name, limit 10 without year filter
- Always set group_by_county: true for ranking/listing questions to avoid duplicate counties
- For year-specific: use exact year; for "current"/"latest" use 2025

EXAMPLES:
"bottom 5 counties by population" → {"filter_year":2025,"sort_by":"total_population","sort_dir":"asc","limit":5,"group_by_county":true,"intent":"Bottom 5 counties by population in 2025"}
"counties where sex ratio exceeds 105 in 2025" → {"filter_year":2025,"filters":[{"field":"sex_ratio","op":"gt","value":105}],"sort_by":"sex_ratio","sort_dir":"desc","limit":47,"group_by_county":true,"intent":"Counties with sex ratio above 105 in 2025"}
"average dependency ratio across all counties 2025" → {"filter_year":2025,"aggregate":"avg","aggregate_field":"dependency_ratio","intent":"Average dependency ratio in 2025"}
"how many counties have population over 1 million in 2025" → {"filter_year":2025,"aggregate":"count","filters":[{"field":"total_population","op":"gt","value":1000000}],"intent":"Count counties with population over 1M"}
"population trend for Nairobi 2021-2025" → {"filter_county":"Nairobi","sort_by":"year","sort_dir":"asc","limit":5,"intent":"Nairobi population 2021-2025"}`;

function executeQuery(records, plan) {
  let rows = [...records];

  // Year filter — default 2025 for ranking/sorting questions
  const needsYearDefault = plan.sort_by && !plan.filter_county && !plan.filter_year;
  const yearToUse = plan.filter_year || (needsYearDefault ? 2025 : null);
  if (yearToUse) rows = rows.filter(r => r.year === yearToUse);

  // County filter
  if (plan.filter_county) {
    rows = rows.filter(r => r.county?.toLowerCase().includes(plan.filter_county.toLowerCase()));
  }

  // Multiple field filters
  const filtersArr = Array.isArray(plan.filters) ? plan.filters : [];
  // Legacy single filter support
  if (plan.filter_field && plan.filter_op && plan.filter_value != null) {
    filtersArr.push({ field: plan.filter_field, op: plan.filter_op, value: plan.filter_value });
  }
  for (const f of filtersArr) {
    rows = rows.filter(r => {
      const v = r[f.field]; if (v == null) return false;
      if (f.op === 'gt' || f.op === '>') return v > f.value;
      if (f.op === 'lt' || f.op === '<') return v < f.value;
      if (f.op === 'gte' || f.op === '>=') return v >= f.value;
      if (f.op === 'lte' || f.op === '<=') return v <= f.value;
      return v === f.value;
    });
  }

  // Aggregate (count, sum, avg, max, min)
  if (plan.aggregate) {
    if (plan.aggregate === 'count') {
      // Count unique counties
      const unique = plan.group_by_county ? new Set(rows.map(r => r.county)).size : rows.length;
      return [{ count: unique, year: yearToUse || 'all' }];
    }
    if (plan.aggregate_field) {
      const vals = rows.map(r => r[plan.aggregate_field]).filter(v => v != null && isFinite(v));
      if (!vals.length) return [];
      const result = {
        sum: vals.reduce((a,b)=>a+b,0),
        avg: vals.reduce((a,b)=>a+b,0)/vals.length,
        max: Math.max(...vals),
        min: Math.min(...vals),
      }[plan.aggregate];
      // For max/min also find which county
      if (plan.aggregate === 'max' || plan.aggregate === 'min') {
        const matchRow = rows.find(r => r[plan.aggregate_field] === result);
        return [{ [plan.aggregate]: +result.toFixed(2), field: plan.aggregate_field, county: matchRow?.county, year: matchRow?.year || yearToUse }];
      }
      return [{ [plan.aggregate]: +result.toFixed(2), field: plan.aggregate_field, counties_included: vals.length, year: yearToUse || 'all' }];
    }
  }

  // Sort
  if (plan.sort_by) {
    const dir = plan.sort_dir === 'asc' ? 1 : -1;
    rows.sort((a,b) => ((a[plan.sort_by]||0) - (b[plan.sort_by]||0)) * dir);
  }

  const limit = Math.min(plan.limit || 10, 47);
  const displayFields = [plan.sort_by, ...(filtersArr.map(f => f.field))].filter(Boolean);
  const primaryField = displayFields[0] || 'total_population';

  // Deduplicate by county if group_by_county
  if (plan.group_by_county !== false) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (!seen.has(r.county)) {
        seen.add(r.county);
        const row = { county: r.county, year: r.year };
        for (const f of displayFields) { if (r[f] != null) row[f] = typeof r[f] === 'number' ? +r[f].toFixed(2) : r[f]; }
        out.push(row);
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  // No dedup — return all rows (e.g. trend over years for one county)
  return rows.slice(0, limit).map(r => {
    const row = { county: r.county, year: r.year };
    for (const f of displayFields) { if (r[f] != null) row[f] = typeof r[f] === 'number' ? +r[f].toFixed(2) : r[f]; }
    return row;
  });
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
    const planRaw = await callGroq(QUERY_SYSTEM, question, 500);
    const plan    = extractJSON(planRaw);

    if (!plan) {
      res.status(200).json({ question, sql: null, results: [], answer: 'Could not understand that question. Please try rephrasing.', error: null });
      return;
    }

    const results = executeQuery(records, plan);

    if (!results.length) {
      res.status(200).json({ question, sql: `/* ${plan.intent} */`, results: [], answer: 'No records matched your query. Try adjusting the filters.', error: null });
      return;
    }

    const ANSWER_SYS = `You are a Kenya population data analyst. Answer the question in 2-3 clear sentences using the data. Use commas for thousands. No markdown, no asterisks, no formatting symbols.`;
    const ANSWER_USER = `Question: ${question}\nData: ${JSON.stringify(results.slice(0,15))}`;
    const rawAnswer   = await callGroq(ANSWER_SYS, ANSWER_USER, 250);
    const answer      = stripThinkTags(rawAnswer).replace(/\*\*/g, '');

    res.status(200).json({ question, sql: `/* ${plan.intent} */`, results, answer, error: null });
  } catch (err) {
    res.status(200).json({ question, sql: null, results: [], answer: null, error: err.message });
  }
};
