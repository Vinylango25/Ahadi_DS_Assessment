// Vercel Serverless Function: GET /api/ai/county-insight?county=Nairobi&year=2025
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'qwen/qwen3.6-27b';

function stripThinkTags(text) {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
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

function fallbackInsight(data) {
  const county   = data.county || 'This county';
  const dep      = data.dependency_ratio || 0;
  const pctChild = data.pct_children || 0;
  const sex      = data.sex_ratio || 100;
  let t = `${county} has a dependency ratio of ${dep.toFixed(1)}. `;
  if (dep > 80)      t += 'High dependency — significant pressure on working-age population. ';
  else if (dep > 60) t += 'Moderate dependency — health planners should monitor this. ';
  else               t += 'Low dependency — relatively balanced age structure. ';
  if (pctChild > 20) t += `With ${pctChild.toFixed(1)}% children under 5, strong paediatric investment is needed. `;
  if (sex > 105)     t += 'Male-skewed sex ratio — may reflect economic migration.';
  else if (sex < 95) t += 'Female-skewed sex ratio — may indicate male out-migration.';
  return t;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const county = (req.query.county || '').trim();
  const year   = parseInt(req.query.year || '2025', 10);

  if (!county) { res.status(400).json({ detail: 'county required' }); return; }

  const bundle = loadPopulationData();
  const data   = bundle?.county_summaries?.[`${county}_${year}`] || { county, year };

  if (!GROQ_API_KEY) {
    res.status(200).json({ county, year, insight: fallbackInsight(data), ai_powered: false, debug: 'no key' });
    return;
  }

  const SYSTEM = `You are a senior public health data analyst specialising in Kenya's demographic trends.
Generate exactly 5 numbered, actionable insights based on the demographic data provided.

Format:
1. **[Short Title]** — Insight text (2-3 sentences, specific and actionable).
2. **[Short Title]** — Insight text.
3. **[Short Title]** — Insight text.
4. **[Short Title]** — Insight text.
5. **[Short Title]** — Insight text.

Cover in order:
1. Population size & service delivery capacity
2. Child health (under-5) — immunisation, nutrition, MCH demand
3. Elderly & ageing — NCDs, elder care needs
4. Sex ratio & gender — equity, migration patterns, gender-specific health
5. Dependency ratio & sustainability — fiscal and health system pressure

Rules: Be SPECIFIC. Actionable. Plain English for Ministry of Health officials. Interpret, don't just describe.`;

  const USER = `County: ${county} | Year: ${year}
- Total population: ${(data.total_population||0).toLocaleString()}
- Children under 5: ${(data.children_under_5||0).toLocaleString()} (${(data.pct_children||0).toFixed(1)}%)
- Working age (15–64): ${(data.working_age||0).toLocaleString()}
- Elderly 65+: ${(data.elderly_65plus||0).toLocaleString()} (${(data.pct_elderly||0).toFixed(1)}%)
- Sex ratio: ${(data.sex_ratio||0).toFixed(1)} males per 100 females
- Dependency ratio: ${(data.dependency_ratio||0).toFixed(1)}`;

  try {
    const insight = await callGroq(SYSTEM, USER);
    res.status(200).json({ county, year, insight, ai_powered: true });
  } catch (err) {
    res.status(200).json({ county, year, insight: fallbackInsight(data), ai_powered: false, error: err.message });
  }
};



