// Vercel Serverless Function: GET /api/ai/national-insight?year=2025
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

// Normalize AI output into clean "N. Title — body\n\n" segments regardless of
// how the model chose to wrap lines or separate points.
function normalizeInsight(text) {
  // Strip control characters (e.g. \x15 NAK used by qwen between points)
  let t = text.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, ' ').replace(/ {2,}/g, ' ').trim();
  // Find every "N. " at a sentence boundary and insert double-newline before it
  // Anchored to: start of string, after period+space, or after newline
  t = t.replace(/(^|[.\n]\s*)([1-9])\.\s+/g, (m, pre, num) => {
    const isStart = pre.trim() === '' && num === '1';
    return isStart ? `${num}. ` : `\n\n${num}. `;
  });
  return t.trim();
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
  const highDep   = [...records].sort((a,b) => (b.dependency_ratio||0)-(a.dependency_ratio||0))
                    .slice(0,3).map(r => `${r.county} (${r.dependency_ratio?.toFixed(1)})`).join(', ');

  if (!GROQ_API_KEYS.length) {
    const fallback = `Kenya total population across 47 counties in ${year}: ${totalPop.toLocaleString()}. Average dependency ratio: ${avgDep.toFixed(1)}. Most populous: ${maxC.county}. Least populous: ${minC.county}.`;
    res.status(200).json({ year, insight: fallback, ai_powered: false });
    return;
  }

  const prompt = `You are a senior public health data analyst specialising in Kenya's demographic trends.
You MUST write EXACTLY 5 numbered insight points. Do not stop before point 5.

Format each point EXACTLY as:
N. Point Title — Insight text (2-3 sentences, specific and actionable, no markdown, no asterisks).

Cover these 5 angles:
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
- Highest dependency counties: ${highDep}

Write all 5 insight points now:
1.`;

  try {
    const raw     = await callGroq(prompt, 6000);
    const cleaned = stripThinkTags(raw).replace(/\*\*/g, '').replace(/\*/g, '').trim();
    const insight = normalizeInsight(cleaned.startsWith('1.') ? cleaned : `1.${cleaned}`);
    res.status(200).json({ year, insight, ai_powered: true });
  } catch (err) {
    const fallback = `Kenya total population across 47 counties in ${year}: ${totalPop.toLocaleString()}. Average dependency ratio: ${avgDep.toFixed(1)}. Most populous: ${maxC.county}. Least populous: ${minC.county}.`;
    res.status(200).json({ year, insight: fallback, ai_powered: false, error: err.message });
  }
};
