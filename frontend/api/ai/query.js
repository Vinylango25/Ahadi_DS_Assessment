// Vercel Serverless Function: POST /api/ai/query
// Comprehensive NL query over Kenya population data
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'qwen/qwen3.6-27b';

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
- "bottom N" / "lowest N" / "least" → sort_dir "asc", limit N, filter_year 2025 (if no year given)
- "top N" / "highest N" / "most" → sort_dir "desc", limit N, filter_year 2025 (if no year given)
- "all counties" ranking → filter_year 2025, group_by_county true, limit 47
- "where X exceeds/above/over Y" → filters: [{field: X, op: "gt", value: Y}]
- "where X below/under Y" → filters: [{field: X, op: "lt", value: Y}]
- "average/mean" → aggregate "avg" on the relevant field
- "total" national → aggregate "sum"
- "how many counties" → aggregate "count"
- "trend" / "over years" / "2021 to 2025" / "all years" → set filter_county, sort_by "year", sort_dir "asc", limit 5, filter_year null, group_by_county false
- "compare X and Y" / "X vs Y" → filter_county "X, Y" (comma-separated), filter_year 2025, group_by_county false, limit 10, sort_by "year", sort_dir "asc"
- "profile" for one county → filter_county name, filter_year 2025, group_by_county false, limit 1
- "scatter" / "correlation" → filter_year 2025, group_by_county true, limit 47, sort_by "total_population"
- Always set group_by_county true for ranking/listing questions to avoid duplicate counties
- For year-specific queries use exact year; for "current"/"latest" use 2025

EXAMPLES:
"bottom 5 counties by population" → {"filter_year":2025,"sort_by":"total_population","sort_dir":"asc","limit":5,"group_by_county":true,"filters":[],"intent":"Bottom 5 counties by population 2025"}
"counties where sex ratio exceeds 105 in 2025" → {"filter_year":2025,"filters":[{"field":"sex_ratio","op":"gt","value":105}],"sort_by":"sex_ratio","sort_dir":"desc","limit":47,"group_by_county":true,"intent":"Counties with sex ratio above 105 in 2025"}
"average dependency ratio across all counties 2025" → {"filter_year":2025,"aggregate":"avg","aggregate_field":"dependency_ratio","filters":[],"intent":"Average dependency ratio in 2025"}
"population trend for Nairobi 2021-2025" → {"filter_county":"Nairobi","filter_year":null,"sort_by":"year","sort_dir":"asc","limit":5,"group_by_county":false,"filters":[],"intent":"Nairobi population trend 2021-2025"}
"compare Nairobi and Mombasa" → {"filter_county":"Nairobi, Mombasa","filter_year":2025,"sort_by":"total_population","sort_dir":"desc","limit":10,"group_by_county":false,"filters":[],"intent":"Nairobi vs Mombasa population comparison 2025"}
"all 47 counties total population 2025" → {"filter_year":2025,"sort_by":"total_population","sort_dir":"desc","limit":47,"group_by_county":true,"filters":[],"intent":"All 47 counties ranked by population 2025"}
"Nairobi population profile 2025" → {"filter_county":"Nairobi","filter_year":2025,"sort_by":null,"sort_dir":"desc","limit":1,"group_by_county":false,"filters":[],"intent":"Nairobi full population profile 2025"}
"scatter population vs dependency ratio" → {"filter_year":2025,"sort_by":"total_population","sort_dir":"desc","limit":47,"group_by_county":true,"filters":[],"intent":"Population vs dependency ratio scatter 2025"}`;

// ── All meaningful data fields (always included when relevant) ──
const ALL_DATA_FIELDS = [
  'total_population','children_under_5','working_age','elderly_65plus',
  'sex_ratio','dependency_ratio','child_dependency_ratio','elderly_dependency_ratio',
  'pct_children','pct_elderly','county_area_km2'
];

function pickFields(plan, filtersArr) {
  // Fields explicitly referenced in the plan
  const explicit = [
    plan.sort_by,
    plan.aggregate_field,
    ...filtersArr.map(f => f.field),
  ].filter(Boolean);

  if (explicit.length > 0) {
    // Always include the primary sort/filter field plus a few context fields
    const extra = ['total_population','dependency_ratio','sex_ratio']
      .filter(f => !explicit.includes(f));
    return [...new Set([...explicit, ...extra])];
  }

  // No explicit fields — return all data fields (county profile / comparison queries)
  return ALL_DATA_FIELDS;
}

function buildRow(r, fields) {
  const row = { county: r.county, year: r.year };
  for (const f of fields) {
    if (r[f] != null) row[f] = typeof r[f] === 'number' ? +r[f].toFixed(2) : r[f];
  }
  return row;
}

function executeQuery(records, plan) {
  let rows = [...records];

  // Year filter — default 2025 for ranking/sorting questions
  const needsYearDefault = plan.sort_by && !plan.filter_county && !plan.filter_year;
  const yearToUse = plan.filter_year || (needsYearDefault ? 2025 : null);
  if (yearToUse) rows = rows.filter(r => r.year === yearToUse);

  // County filter — support multiple counties via comma or "and"/"vs"
  if (plan.filter_county) {
    const countyNames = plan.filter_county
      .split(/,|\s+and\s+|\s+vs\.?\s+/i)
      .map(c => c.trim().toLowerCase())
      .filter(Boolean);
    rows = rows.filter(r =>
      countyNames.some(name => r.county?.toLowerCase().includes(name))
    );
  }

  // Field filters
  const filtersArr = Array.isArray(plan.filters) ? plan.filters : [];
  if (plan.filter_field && plan.filter_op && plan.filter_value != null) {
    filtersArr.push({ field: plan.filter_field, op: plan.filter_op, value: plan.filter_value });
  }
  for (const f of filtersArr) {
    rows = rows.filter(r => {
      const v = r[f.field]; if (v == null) return false;
      if (f.op === 'gt'  || f.op === '>')  return v > f.value;
      if (f.op === 'lt'  || f.op === '<')  return v < f.value;
      if (f.op === 'gte' || f.op === '>=') return v >= f.value;
      if (f.op === 'lte' || f.op === '<=') return v <= f.value;
      return v === f.value;
    });
  }

  // Aggregates
  if (plan.aggregate) {
    if (plan.aggregate === 'count') {
      const unique = plan.group_by_county
        ? new Set(rows.map(r => r.county)).size
        : rows.length;
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
      if (plan.aggregate === 'max' || plan.aggregate === 'min') {
        const matchRow = rows.find(r => r[plan.aggregate_field] === result);
        return [{
          [plan.aggregate]: +result.toFixed(2),
          field: plan.aggregate_field,
          county: matchRow?.county,
          year: matchRow?.year || yearToUse,
        }];
      }
      return [{
        [plan.aggregate]: +result.toFixed(2),
        field: plan.aggregate_field,
        counties_included: vals.length,
        year: yearToUse || 'all',
      }];
    }
  }

  // Sort
  if (plan.sort_by) {
    const dir = plan.sort_dir === 'asc' ? 1 : -1;
    rows.sort((a,b) => ((a[plan.sort_by]||0) - (b[plan.sort_by]||0)) * dir);
  }

  const limit = Math.min(plan.limit || 10, 47);
  const fields = pickFields(plan, filtersArr);

  // Deduplicate by county (ranking / all-county queries)
  if (plan.group_by_county !== false && !plan.filter_county) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (!seen.has(r.county)) {
        seen.add(r.county);
        out.push(buildRow(r, fields));
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  // No dedup — return all rows (trend / county comparison / time series)
  return rows.slice(0, limit).map(r => buildRow(r, fields));
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

    const ANSWER_SYS = `You are a Kenya population data analyst. Analyse the query results and provide a structured insight with exactly 3 to 5 numbered points.

Each point MUST follow this exact format:
N. Point Title — Explanation of the finding in 1-2 sentences using specific numbers from the data.

Rules:
- Use plain text only. No markdown, no asterisks, no bold, no bullet symbols.
- Use commas for thousands (e.g. 1,234,567).
- Each point must have a short title (2-5 words) followed by a dash, then the explanation.
- Reference actual values from the data in every point.
- Be analytical: explain what the numbers mean, not just what they are.

Example format:
1. Population Leader — Nairobi dominates with 5,721,634 residents, nearly 3 times larger than second-placed Kiambu.
2. Urban Concentration — The top 5 counties account for 38% of Kenya total population despite covering less than 15% of land area.
3. Growth Trend — All top counties show consistent growth of 2 to 3 percent annually since 2021.`;
    const ANSWER_USER = `Question: ${question}\nData: ${JSON.stringify(results.slice(0, 20))}\n\nProvide 3-5 numbered analytical insight points about this data.`;
    const rawAnswer   = await callGroq(ANSWER_SYS, ANSWER_USER, 600);
    const answer      = stripThinkTags(rawAnswer).replace(/\*\*/g, '');

    res.status(200).json({ question, sql: `/* ${plan.intent} */`, results, answer, error: null });
  } catch (err) {
    res.status(200).json({ question, sql: null, results: [], answer: null, error: err.message });
  }
};
