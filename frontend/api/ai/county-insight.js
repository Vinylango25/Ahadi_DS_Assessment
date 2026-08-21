// Vercel Serverless Function: GET /api/ai/county-insight?county=Nairobi&year=2025
// Uses Google Gemini 2.0 Flash (free: 1500 req/day, 1M TPM)
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODELS  = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

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

function callGeminiModel(model, prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens || 900 },
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) return reject(new Error(j.error.message));
          resolve(j.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function callGemini(prompt, maxTokens) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try { return await callGeminiModel(model, prompt, maxTokens); }
    catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('quota') || msg.includes('limit') || msg.includes('429') || msg.includes('not found')) {
        lastErr = err; continue;
      }
      throw err;
    }
  }
  throw lastErr;
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

  if (!GEMINI_API_KEY) {
    res.status(200).json({ county, year, insight: fallbackInsight(data), ai_powered: false });
    return;
  }

  const prompt = `You are a senior public health data analyst specialising in Kenya's demographic trends.
Generate exactly 5 numbered, actionable insights based on the demographic data below.

Format each point EXACTLY as:
N. Point Title — Insight text (2-3 sentences, specific and actionable, no markdown, no asterisks).

Cover:
1. Population size and service delivery capacity
2. Child health (under-5) — immunisation, nutrition, MCH demand
3. Elderly and ageing — NCDs, elder care needs
4. Sex ratio and gender — equity, migration patterns
5. Dependency ratio and sustainability — fiscal and health system pressure

Rules: Be SPECIFIC with numbers. Actionable. Plain English. No asterisks, no bold, no markdown.

County: ${county} | Year: ${year}
- Total population: ${(data.total_population||0).toLocaleString()}
- Children under 5: ${(data.children_under_5||0).toLocaleString()} (${(data.pct_children||0).toFixed(1)}%)
- Working age (15-64): ${(data.working_age||0).toLocaleString()}
- Elderly 65+: ${(data.elderly_65plus||0).toLocaleString()} (${(data.pct_elderly||0).toFixed(1)}%)
- Sex ratio: ${(data.sex_ratio||0).toFixed(1)} males per 100 females
- Dependency ratio: ${(data.dependency_ratio||0).toFixed(1)}`;

  try {
    const raw     = await callGemini(prompt, 900);
    const insight = raw.replace(/\*\*/g, '').replace(/\*/g, '').trim();
    res.status(200).json({ county, year, insight, ai_powered: true });
  } catch (err) {
    res.status(200).json({ county, year, insight: fallbackInsight(data), ai_powered: false, error: err.message });
  }
};
