"""
ai_insights.py
--------------
AI-powered insights and natural language SQL for the Ahadi Population Dashboard.

Uses Groq (LLaMA 3.1-8b-instant) — the same free model used in WC project.
Falls back gracefully if GROQ_API_KEY is not set.

Features:
1. generate_county_insight()   — AI narrative for a county's demographic profile
2. generate_national_insight() — AI commentary on national trends
3. text_to_sql()               — Translate user question → SQL → run → return answer
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

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
TEMPERATURE  = float(os.getenv("LLM_TEMPERATURE", "0.3"))
MAX_TOKENS   = int(os.getenv("LLM_MAX_TOKENS", "700"))

_BACKEND_DIR = Path(__file__).resolve().parent
_DB_PATH     = _BACKEND_DIR / "ahadi.db"


def _get_groq_client() -> Any:
    """Return a Groq client or raise if not available."""
    if not _GROQ_AVAILABLE:
        raise RuntimeError("groq package not installed. Run: pip install groq")
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY environment variable not set.")
    return Groq(api_key=GROQ_API_KEY)


def _call_llm(system: str, user: str) -> str:
    """Call Groq LLaMA 3.1 with a system + user prompt."""
    client = _get_groq_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
    )
    return response.choices[0].message.content.strip()


# ── Database schema description for Text-to-SQL ───────────────────────────────
DB_SCHEMA = """
Table: population_records
Columns:
  id               INTEGER PRIMARY KEY
  county           TEXT    -- Kenya county name (e.g. 'Nairobi', 'Mombasa')
  year             INTEGER -- Projection year: 2021, 2022, 2023, 2024, or 2025
  total_population REAL    -- Total population count
  children_under_5 REAL    -- Population under 5 years old (both sexes)
  working_age      REAL    -- Population aged 15-64 (both sexes)
  elderly_65plus   REAL    -- Population aged 65+ (both sexes)
  sex_ratio        REAL    -- Males per 100 females
  dependency_ratio REAL    -- (children + elderly) / working_age * 100
  child_dependency_ratio   REAL -- children / working_age * 100
  elderly_dependency_ratio REAL -- elderly / working_age * 100
  pct_children     REAL    -- % of population that are children under 5
  pct_elderly      REAL    -- % of population that are elderly 65+
  county_area_km2  REAL    -- County area in square kilometres
"""

TEXT_TO_SQL_SYSTEM = f"""You are a SQLite SQL expert for a Kenya population analytics database.

{DB_SCHEMA}

RULES:
1. Generate ONLY valid SQLite SELECT statements — never INSERT, UPDATE, DELETE or DROP.
2. Always use the exact column names from the schema above.
3. For questions about a specific county, use: WHERE LOWER(county) = LOWER('<name>')
4. For 'top N' questions, use ORDER BY ... DESC LIMIT N
5. For 'bottom N' questions, use ORDER BY ... ASC LIMIT N
6. When asked for population statistics, SUM or AVG across all counties for national figures.
7. Output ONLY the raw SQL query — no explanations, no markdown, no backticks.
8. If the question cannot be answered with this schema, output: CANNOT_ANSWER"""

INSIGHT_SYSTEM = """You are a public health data analyst specialising in Kenya's demographic trends.
Generate concise, insightful narrative commentary (2-3 short paragraphs) on the demographic data provided.
Focus on:
- What the numbers mean for health service planning
- Notable patterns (high dependency ratios, age structure, sex ratios)
- Concrete policy recommendations
Use plain English — no jargon. Keep it actionable for Ministry of Health officials.
Do NOT repeat the raw numbers verbatim; interpret them."""


# ── Public API ────────────────────────────────────────────────────────────────

def generate_county_insight(county_data: Dict[str, Any]) -> str:
    """
    Generate an AI narrative insight for a single county's demographic profile.

    Args:
        county_data: Dict with keys matching PopulationRecord fields.

    Returns:
        Markdown-friendly string with 2-3 paragraphs of insight.
        Returns a fallback message if AI is unavailable.
    """
    try:
        county = county_data.get("county", "Unknown")
        year   = county_data.get("year", 2025)

        user_prompt = f"""
County: {county}  |  Year: {year}

Key demographics:
- Total population:       {county_data.get('total_population', 'N/A'):,.0f}
- Children under 5:       {county_data.get('children_under_5', 'N/A'):,.0f} ({county_data.get('pct_children', 0):.1f}%)
- Working age (15–64):    {county_data.get('working_age', 'N/A'):,.0f}
- Elderly 65+:            {county_data.get('elderly_65plus', 'N/A'):,.0f} ({county_data.get('pct_elderly', 0):.1f}%)
- Sex ratio:              {county_data.get('sex_ratio', 'N/A'):.1f} males per 100 females
- Dependency ratio:       {county_data.get('dependency_ratio', 'N/A'):.1f}
- Child dependency ratio: {county_data.get('child_dependency_ratio', 'N/A'):.1f}
- Elderly dependency:     {county_data.get('elderly_dependency_ratio', 'N/A'):.1f}
- County area:            {county_data.get('county_area_km2', 'N/A'):,.0f} km²

Please provide a public health commentary on {county} County's demographic profile."""

        return _call_llm(INSIGHT_SYSTEM, user_prompt)

    except Exception as exc:
        log.warning("AI insight unavailable: %s", exc)
        return _fallback_insight(county_data)


def generate_national_insight(year: int, records: List[Dict[str, Any]]) -> str:
    """
    Generate a national-level AI insight from summary statistics.

    Args:
        year:    The year of data.
        records: List of county records.

    Returns:
        AI-generated narrative or fallback.
    """
    if not records:
        return "No national data available."

    try:
        total_pop  = sum(r.get("total_population", 0) or 0 for r in records)
        avg_dep    = sum(r.get("dependency_ratio", 0) or 0 for r in records) / len(records)
        max_county = max(records, key=lambda r: r.get("total_population", 0) or 0)
        min_county = min(records, key=lambda r: r.get("total_population", 0) or 0)

        user_prompt = f"""
Kenya National Population Data — {year}

- Total population (47 counties):  {total_pop:,.0f}
- Average dependency ratio:        {avg_dep:.1f}
- Most populous county:            {max_county.get('county')} ({max_county.get('total_population', 0):,.0f})
- Least populous county:           {min_county.get('county')} ({min_county.get('total_population', 0):,.0f})
- Number of counties analysed:     {len(records)}

Provide a national-level public health commentary on Kenya's demographic situation in {year}."""

        return _call_llm(INSIGHT_SYSTEM, user_prompt)

    except Exception as exc:
        log.warning("National insight unavailable: %s", exc)
        return f"Kenya had an estimated total population across all 47 counties in {year}. Dependency ratios vary significantly by region, reflecting differing age structures that have implications for health resource allocation."


def text_to_sql_query(question: str) -> Dict[str, Any]:
    """
    Translate a natural language question into a SQL query, execute it,
    and return the results with an AI-generated plain English answer.

    Args:
        question: Natural language question about Kenya's population data.

    Returns:
        Dict with keys: question, sql, results, answer, error
    """
    result: Dict[str, Any] = {
        "question": question,
        "sql":      None,
        "results":  [],
        "answer":   None,
        "error":    None,
    }

    try:
        # Step 1: Generate SQL
        sql_raw = _call_llm(TEXT_TO_SQL_SYSTEM, question).strip()

        # Clean markdown fences if model added them
        sql_raw = re.sub(r"```sql\s*", "", sql_raw)
        sql_raw = re.sub(r"```\s*", "", sql_raw).strip()

        if sql_raw == "CANNOT_ANSWER" or not sql_raw.upper().startswith("SELECT"):
            result["error"] = "This question cannot be answered with the available population data."
            result["answer"] = result["error"]
            return result

        result["sql"] = sql_raw

        # Step 2: Execute query (read-only connection)
        if not _DB_PATH.exists():
            result["error"] = "Database not yet populated. Run the pipeline first."
            result["answer"] = result["error"]
            return result

        con = sqlite3.connect(f"file:{_DB_PATH}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        try:
            cursor = con.execute(sql_raw)
            rows = [dict(r) for r in cursor.fetchall()]
            result["results"] = rows[:50]  # cap at 50 rows for response size
        finally:
            con.close()

        if not rows:
            result["answer"] = "No records found matching your query."
            return result

        # Step 3: Generate natural language answer
        answer_system = """You are a data analyst. Given a SQL query result about Kenya's population data,
provide a clear, concise plain English answer in 1-3 sentences.
Be specific with numbers. Use commas for thousands separators."""

        answer_user = f"""Question: {question}

SQL result (first 10 rows):
{_format_results(rows[:10])}

Answer the question in plain English."""

        result["answer"] = _call_llm(answer_system, answer_user)

    except sqlite3.OperationalError as exc:
        result["error"] = f"SQL error: {exc}"
        result["answer"] = f"I had trouble querying the database: {exc}"
    except Exception as exc:
        log.exception("text_to_sql error: %s", exc)
        result["error"] = str(exc)
        result["answer"] = "I encountered an error processing your question. Please try rephrasing."

    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _format_results(rows: List[Dict[str, Any]]) -> str:
    """Format query results as a readable table string."""
    if not rows:
        return "(empty)"
    headers = list(rows[0].keys())
    lines = [" | ".join(headers)]
    lines.append("-" * len(lines[0]))
    for row in rows:
        lines.append(" | ".join(str(v) for v in row.values()))
    return "\n".join(lines)


def _fallback_insight(data: Dict[str, Any]) -> str:
    """Rule-based fallback insight when AI is unavailable."""
    county = data.get("county", "This county")
    dep_ratio = data.get("dependency_ratio", 0) or 0
    pct_children = data.get("pct_children", 0) or 0
    sex_ratio = data.get("sex_ratio", 100) or 100

    insight = f"{county} has a dependency ratio of {dep_ratio:.1f}, "
    if dep_ratio > 80:
        insight += "which is high and indicates significant pressure on the working-age population to support dependants. "
    elif dep_ratio > 60:
        insight += "which is moderate. Health planners should monitor this closely. "
    else:
        insight += "which is relatively low, suggesting a more balanced age structure. "

    if pct_children > 20:
        insight += f"With {pct_children:.1f}% of the population being children under 5, there is strong demand for immunisation, paediatric care and nutrition programmes. "

    if sex_ratio > 105:
        insight += "The sex ratio skews male, which may reflect migration patterns or economic factors."
    elif sex_ratio < 95:
        insight += "The sex ratio skews female, which may indicate male out-migration for work."

    return insight
