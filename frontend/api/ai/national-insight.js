// Vercel Serverless Function: GET /api/ai/national-insight?year=2025
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

function callGroq(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.3,
      reasoning_effort: 'none',
      max_tokens:  900,
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const year = parseInt(req.query.year || '2025', 10);

  const bundle    = loadPopulationData();
  const summaries = bundle?.county_summaries || {};
  const records   = Object.values(summaries).filter(r => r.year === year);

  if (!records.length) {
    res.status(200).json({ year, insight: `No data for ${year}.`, ai_powered: false });
    return;
  }

  const totalPop  = records.reduce((s, r) => s + (r.total_population || 0), 0);
  const avgDep    = records.reduce((s, r) => s + (r.dependency_ratio  || 0), 0) / records.length;
  const totalU5   = records.reduce((s, r) => s + (r.children_under_5  || 0), 0);
  const totalEld  = records.reduce((s, r) => s + (r.elderly_65plus    || 0), 0);
  const maxCounty = records.reduce((a, b) => (a.total_population||0) > (b.total_population||0) ? a : b);
  const minCounty = records.reduce((a, b) => (a.total_population||0) < (b.total_population||0) ? a : b);

  const fallback = `Kenya's total population across 47 counties in ${year} is ${totalPop.toLocaleString()}. Average dependency ratio: ${avgDep.toFixed(1)}. Most populous: ${maxCounty.county}. Least populous: ${minCounty.county}.`;

  if (!GROQ_API_KEY) {
    res.status(200).json({ year, insight: fallback, ai_powered: false, debug: 'no key' });
    return;
  }

  const SYSTEM = `You are a senior public health data analyst specialising in Kenya's demographic trends.
Generate exactly 5 numbered, actionable national-level insights based on the data provided.

Format:
1. **[Short Title]** — Insight text (2-3 sentences, specific and actionable).
2. **[Short Title]** — Insight text.
3. **[Short Title]** — Insight text.
4. **[Short Title]** — Insight text.
5. **[Short Title]** — Insight text.

Cover in order:
1. Population size & inter-county inequality — resource allocation implications
2. Child health burden (under-5) — immunisation, nutrition, MCH investment needed
3. Elderly & ageing — NCD burden, elder care gaps
4. Dependency ratio — health financing pressure, sustainability
5. Top strategic priority — single most important action for Kenya's Ministry of Health

Rules: Be SPECIFIC with numbers. Actionable. Plain English. Interpret, don't just describe.`;

  const USER = `Kenya National Population Data — ${year}
- Total population (${records.length} counties): ${totalPop.toLocaleString()}
- Children under 5 (national): ${totalU5.toLocaleString()}
- Elderly 65+ (national): ${totalEld.toLocaleString()}
- Average dependency ratio: ${avgDep.toFixed(1)}
- Most populous county: ${maxCounty.county} (${(maxCounty.total_population||0).toLocaleString()})
- Least populous county: ${minCounty.county} (${(minCounty.total_population||0).toLocaleString()})`;

  try {
    const insight = await callGroq(SYSTEM, USER);
    res.status(200).json({ year, insight, ai_powered: true });
  } catch (err) {
    res.status(200).json({ year, insight: fallback, ai_powered: false, error: err.message });
  }
};

