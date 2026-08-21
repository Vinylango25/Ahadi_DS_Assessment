// Vercel Serverless Function: GET /api/ai/county-insight?county=Nairobi&year=2025
// Uses Groq (4-key rotation) — qwen/qwen3.6-27b for insights
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// 4-key rotation — each key has its own daily quota
const GROQ_API_KEYS = [
  process.env.GROQ_API_KEY   || '',
  process.env.GROQ_API_KEY_2 || '',
  process.env.GROQ_API_KEY_3 || '',
  process.env.GROQ_API_KEY_4 || '',
  process.env.GROQ_API_KEY_5 || '',
].filter(Boolean);

const GROQ_ANSWER_MODEL = 'qwen/qwen3.6-27b';

function stripThinkTags(text) {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '').trim();
}

function parsePoints(text) {
  const points = [];
  const clean = (text || '')
    .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/ {2,}/g, ' ').trim();

  const segments = clean
    .split(/\n(?=\d+[\.\):\s]?\s*[A-Z\d])/)
    .map(s => s.trim())
    .filter(s => /^\d+/.test(s));

  for (const seg of segments) {
    const numMatch = seg.match(/^(\d+)[\.\):\s]*/);
    if (!numMatch) continue;
    const rest = seg.slice(numMatch[0].length).trim();
    if (!rest) continue;

    const emDash = rest.match(/^([^\n]{3,100}?)\s*[\u2014\u2013]\s*([\s\S]+)$/);
    if (emDash) { points.push({ title: emDash[1].trim(), body: emDash[2].trim().replace(/\n/g, ' ') }); continue; }

    const hyphen = rest.match(/^([^\n]{3,100}?)\s+-\s+([\s\S]+)$/);
    if (hyphen) { points.push({ title: hyphen[1].trim(), body: hyphen[2].trim().replace(/\n/g, ' ') }); continue; }

    const lines = rest.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines[0].length <= 90) {
      points.push({ title: lines[0], body: lines.slice(1).join(' ') }); continue;
    }

    const blob = lines.join(' ');
    const dot  = blob.search(/\.\s+[A-Z]/);
    if (dot > 10 && dot < 120) {
      points.push({ title: blob.substring(0, dot + 1).trim(), body: blob.substring(dot + 1).trim() });
    } else {
      points.push({ title: '', body: blob });
    }
  }
  return points;
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

function callGroqModel(apiKey, model, prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens || 6000,
    });
    const req = https.request({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) return reject(new Error(j.error.message));
          resolve(j.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function callGroq(prompt, maxTokens) {
  if (!GROQ_API_KEYS.length) throw new Error('No Groq API keys configured.');
  let lastErr;
  for (const apiKey of GROQ_API_KEYS) {
    try {
      return await callGroqModel(apiKey, GROQ_ANSWER_MODEL, prompt, maxTokens);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      const isQuota =
        msg.includes('rate limit') || msg.includes('quota') ||
        msg.includes('tpd') || msg.includes('tpm') ||
        msg.includes('does not exist') || msg.includes('decommissioned') ||
        msg.includes('deprecated') || msg.includes('no longer supported') ||
        msg.includes('exceeded') || msg.includes('limit reached');
      if (isQuota) { lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr || new Error('All Groq keys exhausted.');
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

  if (!GROQ_API_KEYS.length) {
    res.status(200).json({ county, year, insight: buildFallback(data), ai_powered: false });
    return;
  }

  const prompt = `You are a senior public health data analyst specialising in Kenya's demographic trends.
You MUST write EXACTLY 5 numbered insight points. Do not stop before point 5.

Format each point EXACTLY as:
N. Point Title — Insight text (2-3 sentences, specific and actionable, no markdown, no asterisks).

Cover these 5 angles:
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
- Dependency ratio: ${(data.dependency_ratio||0).toFixed(1)}

Write all 5 insight points now:
1.`;

  try {
    const raw     = await callGroq(prompt, 6000);
    const cleaned = stripThinkTags(raw).replace(/\*\*/g, '').replace(/\*/g, '').trim();
    const insight = cleaned.startsWith('1.') ? cleaned : `1.${cleaned}`;
    const points  = parsePoints(insight);
    res.status(200).json({ county, year, insight, points, ai_powered: true });
  } catch (err) {
    res.status(200).json({ county, year, insight: buildFallback(data), ai_powered: false, error: err.message });
  }
};

function buildFallback(data) {
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
