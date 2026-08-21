// Vercel Serverless Function: GET /api/ai/national-insight?year=2025
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const year = parseInt(req.query.year || '2025', 10);

  const bundle    = loadPopulationData();
  const summaries = bundle?.county_summaries || {};
  const records   = Object.values(summaries).filter(r => r.year === year);

  if (!records.length) {
    res.status(200).json({ year, insight: `No data available for ${year}.`, ai_powered: false });
    return;
  }

  const totalPop  = records.reduce((s, r) => s + (r.total_population || 0), 0);
  const avgDep    = records.reduce((s, r) => s + (r.dependency_ratio  || 0), 0) / records.length;
  const totalU5   = records.reduce((s, r) => s + (r.children_under_5  || 0), 0);
  const totalEld  = records.reduce((s, r) => s + (r.elderly_65plus    || 0), 0);
  const maxC      = records.reduce((a, b) => (a.total_population||0) > (b.total_population||0) ? a : b);
  const minC      = records.reduce((a, b) => (a.total_population||0) < (b.total_population||0) ? a : b);
  const highDep   = [...records].sort((a,b) => (b.dependency_ratio||0)-(a.dependency_ratio||0)).slice(0,3).map(r => `${r.county} (${r.dependency_ratio?.toFixed(1)})`).join(', ');

  const fallback = `Kenya total population across 47 counties in ${year}: ${totalPop.toLocaleString()}. Average dependency ratio: ${avgDep.toFixed(1)}. Most populous: ${maxC.county}. Least populous: ${minC.county}.`;

  if (!GEMINI_API_KEY) {
    res.status(200).json({ year, insight: fallback, ai_powered: false });
    return;
  }

  const prompt = `You are a senior public health data analyst specialising in Kenya's demographic trends.
Generate exactly 5 numbered, actionable national-level insights.

Format each point EXACTLY as:
N. Point Title — Insight text (2-3 sentences, specific and actionable, no markdown, no asterisks).

Cover:
1. Population size and inter-county inequality — resource allocation implications
2. Child health burden (under-5) — immunisation, nutrition, MCH investment needed
3. Elderly and ageing — NCD burden, elder care gaps
4. Dependency ratio — health financing pressure and sustainability
5. Top strategic priority — the single most important action for Kenya's Ministry of Health

Rules: Be SPECIFIC with numbers. Actionable. Plain English. No asterisks, no bold, no markdown.

Kenya National Population Data — ${year}
- Total population (${records.length} counties): ${totalPop.toLocaleString()}
- Children under 5: ${totalU5.toLocaleString()}
- Elderly 65+: ${totalEld.toLocaleString()}
- Average dependency ratio: ${avgDep.toFixed(1)}
- Most populous county: ${maxC.county} (${(maxC.total_population||0).toLocaleString()})
- Least populous county: ${minC.county} (${(minC.total_population||0).toLocaleString()})
- Highest dependency counties: ${highDep}`;

  try {
    const raw     = await callGemini(prompt, 900);
    const insight = raw.replace(/\*\*/g, '').replace(/\*/g, '').trim();
    res.status(200).json({ year, insight, ai_powered: true });
  } catch (err) {
    res.status(200).json({ year, insight: fallback, ai_powered: false, error: err.message });
  }
};
