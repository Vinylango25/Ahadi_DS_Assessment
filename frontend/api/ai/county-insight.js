// Vercel Serverless Function: GET /api/ai/county-insight?county=Nairobi&year=2025
// Calls Groq LLaMA 3.1-8b-instant to generate a demographic insight for a county.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

// population.json is copied into dist/browser by the Angular build (from public/)
// On Vercel the output dir is dist/browser, so we read from there.
// In the serverless function, __dirname is the api/ai folder; population.json
// is at ../../dist/browser/population.json relative to this file at build time.
// However Vercel also copies all outputDirectory files alongside functions, so
// we try multiple paths.
function loadPopulationData() {
  const candidates = [
    path.join(__dirname, '../population.json'),          // api/population.json
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
      max_tokens:  900,
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

function fallbackInsight(data) {
  const county     = data.county || 'This county';
  const depRatio   = data.dependency_ratio || 0;
  const pctChild   = data.pct_children || 0;
  const sexRatio   = data.sex_ratio || 100;
  let insight = `${county} has a dependency ratio of ${depRatio.toFixed(1)}, `;
  if (depRatio > 80)      insight += 'which is high and indicates significant pressure on the working-age population. ';
  else if (depRatio > 60) insight += 'which is moderate. Health planners should monitor this closely. ';
  else                    insight += 'which is relatively low, suggesting a balanced age structure. ';
  if (pctChild > 20) insight += `With ${pctChild.toFixed(1)}% children under 5, there is strong demand for paediatric services. `;
  if (sexRatio > 105)     insight += 'The sex ratio skews male, possibly reflecting migration patterns.';
  else if (sexRatio < 95) insight += 'The sex ratio skews female, possibly indicating male out-migration.';
  return insight;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const county = (req.query.county || '').trim();
  const year   = parseInt(req.query.year || '2025', 10);

  if (!county) {
    res.status(400).json({ detail: 'county parameter is required' });
    return;
  }

  // Find county data from population.json
  const bundle = loadPopulationData();
  const key    = `${county}_${year}`;
  const data   = bundle?.county_summaries?.[key] || { county, year };

  if (!GROQ_API_KEY) {
    res.status(200).json({
      county,
      year,
      insight: fallbackInsight(data),
      ai_powered: false,
    });
    return;
  }

  const SYSTEM = `You are a senior public health data analyst specialising in Kenya's demographic trends.
Generate exactly 5 numbered, actionable insights based on the demographic data provided.

Format your response as:
1. **[Short Title]** — Insight text (2-3 sentences, specific and actionable).
2. **[Short Title]** — Insight text.
3. **[Short Title]** — Insight text.
4. **[Short Title]** — Insight text.
5. **[Short Title]** — Insight text.

Cover these 5 angles in order:
1. Population size & growth — what it means for facility capacity and service delivery planning
2. Child health (under-5) — immunisation, nutrition, maternal & child health service demand
3. Elderly & ageing — NCDs, elder care, pension/social protection needs
4. Sex ratio & gender — gender equity in services, migration implications, maternal/paternal health
5. Dependency ratio & sustainability — fiscal and health system pressure, workforce planning

Rules:
- Be SPECIFIC — link every number to a real planning consequence
- Each insight must be actionable by a Ministry of Health official
- Plain English, no jargon
- Do NOT just repeat the numbers — interpret and recommend`;


  const USER = `County: ${county}  |  Year: ${year}

Key demographics:
- Total population:       ${(data.total_population || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}
- Children under 5:       ${(data.children_under_5 || 0).toLocaleString('en-US', {maximumFractionDigits: 0})} (${(data.pct_children || 0).toFixed(1)}%)
- Working age (15–64):    ${(data.working_age || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}
- Elderly 65+:            ${(data.elderly_65plus || 0).toLocaleString('en-US', {maximumFractionDigits: 0})} (${(data.pct_elderly || 0).toFixed(1)}%)
- Sex ratio:              ${(data.sex_ratio || 0).toFixed(1)} males per 100 females
- Dependency ratio:       ${(data.dependency_ratio || 0).toFixed(1)}

Please provide a public health commentary on ${county} County's demographic profile.`;

  try {
    const insight = await callGroq(SYSTEM, USER);
    res.status(200).json({ county, year, insight, ai_powered: true });
  } catch (err) {
    res.status(200).json({
      county, year,
      insight:    fallbackInsight(data),
      ai_powered: false,
    });
  }
};
