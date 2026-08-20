// Vercel Serverless Function: GET /api/ai/national-insight?year=2025
// Generates a national-level Kenya demographic insight using Groq LLaMA 3.1.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

function loadPopulationData() {
  const candidates = [
    path.join(__dirname, '../../dist/browser/population.json'),
    path.join(__dirname, '../../../dist/browser/population.json'),
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
      max_tokens:  700,
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const year = parseInt(req.query.year || '2025', 10);

  // Build national summary from population.json
  const bundle = loadPopulationData();
  const summaries = bundle?.county_summaries || {};

  const records = Object.values(summaries)
    .filter(r => r.year === year);

  if (!records.length) {
    res.status(200).json({
      year,
      insight: `National population data for ${year} is not yet available.`,
      ai_powered: false,
    });
    return;
  }

  const totalPop  = records.reduce((s, r) => s + (r.total_population || 0), 0);
  const avgDep    = records.reduce((s, r) => s + (r.dependency_ratio || 0), 0) / records.length;
  const maxCounty = records.reduce((a, b) => (a.total_population || 0) > (b.total_population || 0) ? a : b);
  const minCounty = records.reduce((a, b) => (a.total_population || 0) < (b.total_population || 0) ? a : b);

  const fallback = `Kenya's estimated total population across all 47 counties in ${year} is ${totalPop.toLocaleString('en-US', {maximumFractionDigits: 0})}. The average dependency ratio of ${avgDep.toFixed(1)} reflects demographic pressure on working-age populations. ${maxCounty.county} is the most populous county, while ${minCounty.county} is the least populous.`;

  if (!GROQ_API_KEY) {
    res.status(200).json({ year, insight: fallback, ai_powered: false });
    return;
  }

  const SYSTEM = `You are a public health data analyst specialising in Kenya's demographic trends.
Generate concise, insightful narrative commentary (2-3 short paragraphs) on the demographic data provided.
Focus on what the numbers mean for health service planning, notable patterns, and concrete policy recommendations.
Use plain English — no jargon. Keep it actionable for Ministry of Health officials.`;

  const USER = `Kenya National Population Data — ${year}

- Total population (${records.length} counties): ${totalPop.toLocaleString('en-US', {maximumFractionDigits: 0})}
- Average dependency ratio:                      ${avgDep.toFixed(1)}
- Most populous county:  ${maxCounty.county} (${(maxCounty.total_population || 0).toLocaleString('en-US', {maximumFractionDigits: 0})})
- Least populous county: ${minCounty.county} (${(minCounty.total_population || 0).toLocaleString('en-US', {maximumFractionDigits: 0})})
- Counties analysed:     ${records.length}

Provide a national-level public health commentary on Kenya's demographic situation in ${year}.`;

  try {
    const insight = await callGroq(SYSTEM, USER);
    res.status(200).json({ year, insight, ai_powered: true });
  } catch (err) {
    res.status(200).json({ year, insight: fallback, ai_powered: false });
  }
};
