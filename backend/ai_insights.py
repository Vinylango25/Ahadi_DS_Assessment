"""
ai_insights.py
--------------
AI-powered insights and natural language SQL for the Ahadi Population Dashboard.

Uses Groq (qwen/qwen3.6-27b + groq/compound-mini) — same models as the
Vercel serverless functions.  Falls back gracefully if GROQ_API_KEY is not set.

Returns structured points[] arrays so the frontend renders 5-point insight cards.
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger("ahadi.ai")

# ── Groq client ───────────────────────────────────────────────────────────────
try:
    from groq import Groq
    _GROQ_AVAILABLE = True
except ImportError:
    _GROQ_AVAILABLE = False
    log.warning("groq package not installed — AI features disabled. Run: pip install groq")

GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL      = os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b")        # insight / answer model
GROQ_PLAN_MODEL = "groq/compound-mini"                               # fast plan model (no <think>)
TEMPERATURE     = float(os.getenv("LLM_TEMPERATURE", "0.3"))
MAX_TOKENS      = int(os.getenv("LLM_MAX_TOKENS", "6000"))

_BACKEND_DIR = Path(__file__).resolve().parent
_DB_PATH     = _BACKEND_DIR / "ahadi.db"


# ── API key pool — reads GROQ_API_KEY, GROQ_API_KEY_2 … GROQ_API_KEY_5 ──────
def _get_api_keys() -> list[str]:
    """Collect all configured Groq API keys, deduplicated, non-empty."""
    keys: list[str] = []
    # Primary key
    if GROQ_API_KEY:
        keys.append(GROQ_API_KEY)
    # Numbered extras (matching the Vercel/Render env var convention: _2 … _5)
    for i in range(2, 6):
        k = os.getenv(f"GROQ_API_KEY_{i}", "")
        if k and k not in keys:
            keys.append(k)
    return keys


# ── Client factory ─────────────────────────────────────────────────────────────
def _get_client(api_key: str) -> Any:
    if not _GROQ_AVAILABLE:
        raise RuntimeError("groq package not installed. Run: pip install groq")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY environment variable not set.")
    return Groq(api_key=api_key)


def _call(model: str, prompt: str, max_tokens: int = 6000) -> str:
    """Call Groq, rotating through all configured API keys on 429 rate-limit errors."""
    keys = _get_api_keys()
    if not keys:
        raise RuntimeError("GROQ_API_KEY environment variable not set.")

    last_exc: Exception = RuntimeError("No API keys available.")
    for key in keys:
        try:
            client = _get_client(key)
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=TEMPERATURE,
                max_tokens=max_tokens,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            err_str = str(exc)
            # On rate-limit (429 / tokens TPD/TPM), try next key
            if "rate_limit_exceeded" in err_str or "429" in err_str:
                log.warning("Key ending ...%s hit rate limit, trying next key. (%s)", key[-6:], exc)
                last_exc = exc
                continue
            # Any other error (auth, model not found, etc.) — raise immediately
            raise

    # All keys exhausted
    raise last_exc


# ── Helpers ────────────────────────────────────────────────────────────────────
def _strip_think(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE) \
             .replace("<think>", "").strip()


def _parse_points(text: str) -> List[Dict[str, str]]:
    """Parse LLM output into [{title, body}, ...] — same logic as Vercel functions."""
    points: List[Dict[str, str]] = []
    clean = (text or "") \
        .replace("\x00", " ").replace("**", "").replace("*", "") \
        .strip()

    # Split before each line that starts with a digit
    segments = [s.strip() for s in re.split(r"\n(?=\d+[\.\):\s]?\s*[A-Z\d])", clean)
                if re.match(r"^\d+", s.strip())]

    for seg in segments:
        m = re.match(r"^(\d+)[\.\):\s]*", seg)
        if not m:
            continue
        rest = seg[m.end():].strip()
        if not rest:
            continue

        # Strategy A: em/en-dash separator
        em = re.match(r"^([^\n]{3,100}?)\s*[\u2014\u2013]\s*([\s\S]+)$", rest)
        if em:
            points.append({"title": em.group(1).strip(),
                            "body": em.group(2).strip().replace("\n", " ")})
            continue

        # Strategy B: space-hyphen-space
        hy = re.match(r"^([^\n]{3,100}?)\s+-\s+([\s\S]+)$", rest)
        if hy:
            points.append({"title": hy.group(1).strip(),
                            "body": hy.group(2).strip().replace("\n", " ")})
            continue

        # Strategy C: first short line is title
        lines = [l.strip() for l in rest.split("\n") if l.strip()]
        if len(lines) >= 2 and len(lines[0]) <= 90:
            points.append({"title": lines[0], "body": " ".join(lines[1:])})
            continue

        # Strategy D: split at first sentence boundary
        blob = " ".join(lines)
        dot  = re.search(r"\.\s+[A-Z]", blob)
        if dot and 10 < dot.start() < 120:
            points.append({"title": blob[:dot.start() + 1].strip(),
                            "body": blob[dot.start() + 1:].strip()})
        else:
            points.append({"title": "", "body": blob})

    return points


def _friendly_error(exc: Exception) -> str:
    """Convert a Groq API exception into a short, user-friendly message."""
    msg = str(exc)
    # Rate limit (TPD or TPM)
    if "rate_limit_exceeded" in msg or "429" in msg:
        # Try to extract the retry time
        import re as _re
        wait = _re.search(r"try again in ([^.]+)", msg)
        wait_str = f" Try again in {wait.group(1)}." if wait else " Please try again later."
        return (
            f"⏳ Daily token limit reached for the AI model.{wait_str} "
            "You can upgrade at https://console.groq.com/settings/billing or wait for the limit to reset."
        )
    # No API key
    if "GROQ_API_KEY" in msg or "api_key" in msg.lower() or "authentication" in msg.lower():
        return "🔑 AI features require a GROQ_API_KEY. Add it in your .env file or Render dashboard."
    # Model not found
    if "model_not_found" in msg or "does not exist" in msg:
        return "🤖 The configured AI model is unavailable. Check GROQ_MODEL in your environment."
    # Generic quota / billing
    if "quota" in msg.lower() or "billing" in msg.lower():
        return "💳 AI quota exceeded. Check your Groq billing at https://console.groq.com/settings/billing."
    # Generic fallback — still user-friendly, not a raw JSON blob
    return "⚠️ AI service temporarily unavailable. Please try again in a moment."

    clean = _strip_think(text).replace("```json", "").replace("```", "").strip()
    s, e = clean.find("{"), clean.rfind("}")
    if s == -1 or e == -1:
        return None
    try:
        import json
        return json.loads(clean[s:e + 1])
    except Exception:
        return None


# ── Insight prompts ────────────────────────────────────────────────────────────
_INSIGHT_PROMPT = """You are a senior public health data analyst specialising in Kenya's demographic trends.
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

{data_block}

Write all 5 insight points now:
1."""


def generate_county_insight(county_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate structured 5-point insight for a county.
    Returns dict with keys: insight (str), points (list), ai_powered (bool).
    """
    county = county_data.get("county", "Unknown")
    year   = county_data.get("year", 2025)

    data_block = f"""County: {county}  |  Year: {year}
- Total population:       {county_data.get('total_population', 0):,.0f}
- Children under 5:       {county_data.get('children_under_5', 0):,.0f} ({county_data.get('pct_children', 0):.1f}%)
- Working age (15–64):    {county_data.get('working_age', 0):,.0f}
- Elderly 65+:            {county_data.get('elderly_65plus', 0):,.0f} ({county_data.get('pct_elderly', 0):.1f}%)
- Sex ratio:              {county_data.get('sex_ratio', 0):.1f} males per 100 females
- Dependency ratio:       {county_data.get('dependency_ratio', 0):.1f}
- Child dependency:       {county_data.get('child_dependency_ratio', 0):.1f}
- Elderly dependency:     {county_data.get('elderly_dependency_ratio', 0):.1f}
- County area:            {county_data.get('county_area_km2', 0):,.0f} km²"""

    prompt = _INSIGHT_PROMPT.format(data_block=data_block)

    try:
        raw     = _call(GROQ_MODEL, prompt, MAX_TOKENS)
        cleaned = _strip_think(raw).replace("**", "").replace("*", "").strip()
        insight = cleaned if cleaned.startswith("1.") else f"1.{cleaned}"
        points  = _parse_points(insight)
        return {"insight": insight, "points": points, "ai_powered": True}
    except Exception as exc:
        log.warning("County insight failed: %s", exc)
        friendly = _friendly_error(exc)
        fb = _fallback_insight(county_data)
        return {"insight": fb, "points": [], "ai_powered": False, "error": friendly}


def generate_national_insight(year: int, records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Generate structured 5-point national insight.
    Returns dict with keys: insight (str), points (list), ai_powered (bool).
    """
    if not records:
        return {"insight": "No national data available.", "points": [], "ai_powered": False}

    total_pop   = sum(r.get("total_population", 0) or 0 for r in records)
    avg_dep     = sum(r.get("dependency_ratio", 0) or 0 for r in records) / len(records)
    max_c = max(records, key=lambda r: r.get("total_population", 0) or 0)
    min_c = min(records, key=lambda r: r.get("total_population", 0) or 0)

    data_block = f"""Kenya National Population Data — {year}
- Total population (47 counties):  {total_pop:,.0f}
- Average dependency ratio:        {avg_dep:.1f}
- Most populous county:            {max_c.get('county')} ({max_c.get('total_population', 0):,.0f})
- Least populous county:           {min_c.get('county')} ({min_c.get('total_population', 0):,.0f})
- Number of counties analysed:     {len(records)}"""

    prompt = _INSIGHT_PROMPT.format(data_block=data_block)

    try:
        raw     = _call(GROQ_MODEL, prompt, MAX_TOKENS)
        cleaned = _strip_think(raw).replace("**", "").replace("*", "").strip()
        insight = cleaned if cleaned.startswith("1.") else f"1.{cleaned}"
        points  = _parse_points(insight)
        return {"insight": insight, "points": points, "ai_powered": True}
    except Exception as exc:
        log.warning("National insight failed: %s", exc)
        friendly = _friendly_error(exc)
        fallback = f"Kenya had an estimated population of {total_pop:,.0f} across 47 counties in {year}."
        return {"insight": fallback, "points": [], "ai_powered": False, "error": friendly}


# ── NL Query ──────────────────────────────────────────────────────────────────
_DB_SCHEMA = """
Table: population_records
Columns:
  id               INTEGER PRIMARY KEY
  county           TEXT    -- Kenya county name
  year             INTEGER -- 2021, 2022, 2023, 2024, or 2025
  total_population REAL
  children_under_5 REAL
  working_age      REAL    -- 15-64
  elderly_65plus   REAL
  sex_ratio        REAL    -- males per 100 females
  dependency_ratio REAL
  child_dependency_ratio   REAL
  elderly_dependency_ratio REAL
  pct_children     REAL
  pct_elderly      REAL
  county_area_km2  REAL
"""

_SQL_SYSTEM = f"""You are a SQLite SQL expert for a Kenya population analytics database.
{_DB_SCHEMA}
RULES:
1. Generate ONLY valid SQLite SELECT statements.
2. Use exact column names.
3. For 'top N' → ORDER BY ... DESC LIMIT N
4. For 'bottom N' → ORDER BY ... ASC LIMIT N
5. For 'all counties ranked' → no LIMIT, ORDER BY ... DESC
6. Output ONLY the raw SQL — no explanation, no markdown, no backticks.
7. If unanswerable with this schema output: CANNOT_ANSWER"""

_ANSWER_PROMPT = """You are a Kenya population data analyst. You MUST provide EXACTLY 5 numbered insight points — no more, no fewer.

Each point MUST follow this exact format:
N. Point Title — Explanation in 1-2 sentences using specific numbers from the data.

Rules:
- Write all 5 points.
- Plain text only. No markdown, no asterisks.
- Use commas for thousands (e.g. 1,234,567).
- Be analytical — explain what the numbers mean.

Question: {question}
Data (first 20 rows): {data}

Write all 5 insight points now:
1."""


def text_to_sql_query(question: str) -> Dict[str, Any]:
    """
    Translate NL question → SQL → execute → 5-point structured answer.
    Returns: {question, sql, results, answer, points, error}
    """
    result: Dict[str, Any] = {
        "question": question,
        "sql":      None,
        "results":  [],
        "answer":   None,
        "points":   [],
        "error":    None,
    }

    try:
        # Step 1: Generate SQL using fast plan model
        sql_raw = _call(GROQ_PLAN_MODEL,
                        f"{_SQL_SYSTEM}\n\nQuestion: {question}\n\nSQL:",
                        max_tokens=400).strip()
        sql_raw = re.sub(r"```sql\s*", "", sql_raw)
        sql_raw = re.sub(r"```\s*", "", sql_raw).strip()

        if sql_raw == "CANNOT_ANSWER" or not sql_raw.upper().startswith("SELECT"):
            result["error"]  = "This question cannot be answered with the available data."
            result["answer"] = result["error"]
            return result

        result["sql"] = sql_raw

        if not _DB_PATH.exists():
            result["error"]  = "Database not yet populated. Run the pipeline first."
            result["answer"] = result["error"]
            return result

        con = sqlite3.connect(f"file:{_DB_PATH}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        try:
            cursor = con.execute(sql_raw)
            rows   = [dict(r) for r in cursor.fetchall()]
            result["results"] = rows[:50]
        finally:
            con.close()

        if not rows:
            result["answer"] = "No records matched your query."
            return result

        # Step 2: Generate structured 5-point answer
        import json
        answer_prompt = _ANSWER_PROMPT.format(
            question=question,
            data=json.dumps(rows[:20])
        )
        raw_answer  = _call(GROQ_MODEL, answer_prompt, MAX_TOKENS)
        answer_text = _strip_think(raw_answer).replace("**", "").strip()
        answer      = answer_text if answer_text.startswith("1.") else f"1.{answer_text}"
        points      = _parse_points(answer)

        result["answer"] = answer
        result["points"] = points

    except sqlite3.OperationalError as exc:
        result["error"]  = f"SQL error: {exc}"
        result["answer"] = f"Database query error: {exc}"
    except Exception as exc:
        log.exception("text_to_sql error: %s", exc)
        friendly = _friendly_error(exc)
        result["error"]  = friendly
        result["answer"] = friendly

    return result


# ── Fallback (no API key) ──────────────────────────────────────────────────────
def _fallback_insight(data: Dict[str, Any]) -> str:
    county    = data.get("county", "This county")
    dep       = data.get("dependency_ratio", 0) or 0
    pct_child = data.get("pct_children", 0) or 0
    sex       = data.get("sex_ratio", 100) or 100
    t = f"{county} has a dependency ratio of {dep:.1f}. "
    if dep > 80:
        t += "High dependency — significant pressure on the working-age population. "
    elif dep > 60:
        t += "Moderate dependency — health planners should monitor closely. "
    else:
        t += "Relatively low dependency — balanced age structure. "
    if pct_child > 20:
        t += f"With {pct_child:.1f}% children under 5, paediatric investment is critical. "
    if sex > 105:
        t += "Male-skewed sex ratio may reflect economic in-migration."
    elif sex < 95:
        t += "Female-skewed sex ratio may indicate male out-migration for work."
    return t
