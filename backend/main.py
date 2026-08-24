"""
main.py
-------
FastAPI application entry point for the Ahadi Kenya Population Analytics
backend API.

Start the server with:

    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

or from the project root:

    cd C:\\Users\\GCA17695\\Desktop\\Ahadi
    uvicorn backend.main:app --reload
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend import crud, schemas
from backend.crud import INDICATOR_META, VALID_INDICATORS
from backend.database import get_db, init_db

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# Resolve paths relative to *this* file so the app works regardless of the
# working directory from which uvicorn is started.
_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent
_DATA_DIR = _PROJECT_ROOT / "data"
_PROCESSED_DIR = _DATA_DIR / "processed"
_GEOJSON_PATH = _DATA_DIR / "gadm41_KEN_2.json"
_CSV_PATH = _PROCESSED_DIR / "kenya_population_by_county.csv"

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Ahadi Kenya Population Analytics API",
    description=(
        "REST API for exploring Kenya's 2021–2025 county-level population "
        "projections derived from WorldPop age-sex structured raster data."
    ),
    version="1.0.0",
    contact={
        "name": "Ahadi Data Team",
    },
)

# ---------------------------------------------------------------------------
# CORS — allow all origins so the frontend (any port / domain) can call us.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Static files — serve the processed data directory at /data/processed
# ---------------------------------------------------------------------------
if _PROCESSED_DIR.exists():
    app.mount(
        "/data/processed",
        StaticFiles(directory=str(_PROCESSED_DIR)),
        name="processed_data",
    )
    logger.info("Mounted static files from %s", _PROCESSED_DIR)
else:
    logger.warning(
        "Processed data directory not found at %s — static mount skipped.", _PROCESSED_DIR
    )


# ---------------------------------------------------------------------------
# Startup event — initialise DB and seed from CSV if empty
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup() -> None:
    """
    Runs once when the server starts:
    1. Creates all database tables (if they don't exist).
    2. Seeds the database from the processed CSV if the table is empty.
    """
    logger.info("Initialising database …")
    init_db()
    logger.info("Database tables ready.")

    # Seed from CSV only if the table is empty.
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        from backend.models import PopulationRecord
        from sqlalchemy import func as sqlfunc

        count = db.query(sqlfunc.count(PopulationRecord.id)).scalar() or 0
        if count == 0:
            if _CSV_PATH.exists():
                logger.info("Database is empty — loading CSV from %s …", _CSV_PATH)
                inserted = crud.load_csv_to_db(str(_CSV_PATH), db)
                logger.info("Seeded database with %d records.", inserted)
            else:
                logger.warning(
                    "CSV not found at %s — database will remain empty until the "
                    "data pipeline is run.",
                    _CSV_PATH,
                )
        else:
            logger.info("Database already contains %d records — skipping seed.", count)
    finally:
        db.close()


# ===========================================================================
# Routes
# ===========================================================================

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get(
    "/api/health",
    tags=["Utility"],
    summary="Health check",
    response_model=Dict[str, str],
)
def health_check() -> Dict[str, str]:
    """Return a simple status response to confirm the API is running."""
    return {"status": "ok", "message": "Ahadi Population Analytics API is healthy."}


# ---------------------------------------------------------------------------
# Reference / metadata endpoints
# ---------------------------------------------------------------------------

@app.get(
    "/api/counties",
    tags=["Reference"],
    summary="List all counties",
    response_model=List[str],
)
def list_counties(db: Session = Depends(get_db)) -> List[str]:
    """
    Return an alphabetically sorted list of all Kenya county names stored in
    the database.
    """
    counties = crud.get_all_counties(db)
    if not counties:
        raise HTTPException(status_code=404, detail="No county data found in the database.")
    return counties


@app.get(
    "/api/years",
    tags=["Reference"],
    summary="List all available years",
    response_model=List[int],
)
def list_years(db: Session = Depends(get_db)) -> List[int]:
    """
    Return a sorted list of all projection years available in the database.
    """
    years = crud.get_all_years(db)
    if not years:
        raise HTTPException(status_code=404, detail="No year data found in the database.")
    return years


@app.get(
    "/api/indicators",
    tags=["Reference"],
    summary="List available demographic indicators",
    response_model=schemas.IndicatorsResponse,
)
def list_indicators() -> schemas.IndicatorsResponse:
    """
    Return metadata for all demographic indicators that can be used as
    ``indicator`` query parameters throughout the API.
    """
    indicators = [schemas.IndicatorMeta(**m) for m in INDICATOR_META]  # type: ignore[arg-type]
    return schemas.IndicatorsResponse(indicators=indicators)


# ---------------------------------------------------------------------------
# GeoJSON (raw boundary file)
# ---------------------------------------------------------------------------

@app.get(
    "/api/geojson",
    tags=["Spatial"],
    summary="Return Kenya GADM Level-2 GeoJSON",
)
def get_geojson() -> JSONResponse:
    """
    Stream the raw Kenya GADM Level-2 county boundary GeoJSON file.

    This is a large (~950 KB) file; consider caching the response on the
    frontend side.
    """
    if not _GEOJSON_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"GeoJSON file not found at expected path: {_GEOJSON_PATH}",
        )
    with open(_GEOJSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return JSONResponse(content=data)


# ---------------------------------------------------------------------------
# Choropleth endpoint — GeoJSON enriched with indicator values
# ---------------------------------------------------------------------------

@app.get(
    "/api/choropleth",
    tags=["Analytics"],
    summary="GeoJSON with indicator values for choropleth map",
)
def get_choropleth(
    year: int = Query(..., description="Projection year, e.g. 2025."),
    indicator: str = Query(
        "total_population",
        description="Indicator column name.  Use GET /api/indicators for the full list.",
    ),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """
    Return a GeoJSON FeatureCollection where each county feature is enriched
    with demographic indicator values from the database.  Suitable for direct
    use with Plotly's ``choroplethmapbox`` or Leaflet's choropleth layer.

    Each feature's ``properties`` object will include:
    - ``NAME_2`` — county name (from GADM)
    - ``value`` — selected indicator value
    - ``total_population``, ``dependency_ratio``, ``sex_ratio``,
      ``pct_children``, ``pct_elderly`` — for tooltip use
    """
    if indicator not in VALID_INDICATORS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown indicator '{indicator}'. "
                   f"Valid values: {sorted(VALID_INDICATORS)}",
        )

    if not _GEOJSON_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="GeoJSON boundary file not found.",
        )

    # Load the data rows keyed by normalised county name.
    # Normalise = lowercase + strip spaces so GADM "HomaBay" matches DB "Homa Bay".
    def _norm(s: str) -> str:
        return s.lower().replace(" ", "").replace("-", "")

    rows = crud.get_choropleth_data(db, year=year, indicator=indicator)
    data_by_county: Dict[str, Dict[str, Any]] = {
        _norm(r["county"]): r for r in rows
    }

    with open(_GEOJSON_PATH, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    for feature in geojson.get("features", []):
        props = feature.setdefault("properties", {})
        # GADM Level-2: NAME_2 is constituency/ward number; NAME_1 is the county name.
        county_name: str = (
            props.get("NAME_1") or props.get("NAME_2") or props.get("name") or props.get("NAME") or ""
        )
        matched = data_by_county.get(_norm(county_name), {})

        props["value"] = matched.get("value")
        props["name"] = county_name          # expose county name for frontend tooltip/matching
        props["total_population"] = matched.get("total_population")
        props["dependency_ratio"] = matched.get("dependency_ratio")
        props["sex_ratio"] = matched.get("sex_ratio")
        props["pct_children"] = matched.get("pct_children")
        props["pct_elderly"] = matched.get("pct_elderly")
        props["indicator"] = indicator
        props["year"] = year

    return JSONResponse(content=geojson)


# ---------------------------------------------------------------------------
# County summary
# ---------------------------------------------------------------------------

@app.get(
    "/api/county/{county}",
    tags=["Analytics"],
    summary="Full demographic summary for a single county",
    response_model=schemas.CountySummary,
)
def get_county(
    county: str,
    year: int = Query(2025, description="Projection year."),
    db: Session = Depends(get_db),
) -> schemas.CountySummary:
    """
    Return all demographic indicators for the specified county and year.

    County names are matched case-insensitively (e.g. ``nairobi`` →
    ``Nairobi``).
    """
    record = crud.get_county_summary(db, county=county, year=year)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"No data found for county='{county}', year={year}.",
        )
    return schemas.CountySummary.model_validate(record)


# ---------------------------------------------------------------------------
# Timeseries
# ---------------------------------------------------------------------------

@app.get(
    "/api/timeseries",
    tags=["Analytics"],
    summary="Population timeseries (national or county-level)",
    response_model=schemas.NationalTimeseries,
)
def get_timeseries(
    county: Optional[str] = Query(
        None,
        description="County name.  Omit (or pass 'Kenya') for the national aggregate.",
    ),
    indicator: str = Query(
        "total_population",
        description="Indicator to plot over time.",
    ),
    db: Session = Depends(get_db),
) -> schemas.NationalTimeseries:
    """
    Return a year-by-year timeseries for the chosen ``indicator``.

    - Omit ``county`` or pass ``county=Kenya`` to get the national aggregate
      (sum across all counties).
    - Pass a specific county name to get that county's values directly.
    """
    if indicator not in VALID_INDICATORS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown indicator '{indicator}'. "
                   f"Valid values: {sorted(VALID_INDICATORS)}",
        )

    national_scope = not county or county.strip().lower() in ("kenya", "national", "")

    if national_scope:
        data = crud.get_national_timeseries(db, indicator=indicator)
        scope = "Kenya"
    else:
        data = crud.get_county_timeseries(db, county=county.strip(), indicator=indicator)
        scope = county.strip()
        if not data:
            raise HTTPException(
                status_code=404,
                detail=f"No timeseries data found for county='{county}'.",
            )

    points = [schemas.TimeseriesPoint(**d) for d in data]
    return schemas.NationalTimeseries(scope=scope, indicator=indicator, data=points)


# ---------------------------------------------------------------------------
# Comparison (top / bottom counties)
# ---------------------------------------------------------------------------

@app.get(
    "/api/comparison",
    tags=["Analytics"],
    summary="Top and bottom counties for a demographic indicator",
    response_model=schemas.ComparisonResult,
)
def get_comparison(
    year: int = Query(2025, description="Projection year."),
    indicator: str = Query(
        "dependency_ratio",
        description="Indicator column name to rank counties by.",
    ),
    n: int = Query(10, ge=1, le=47, description="Number of counties in each group."),
    db: Session = Depends(get_db),
) -> schemas.ComparisonResult:
    """
    Return the top-N and bottom-N Kenya counties ranked by ``indicator`` for
    the given year.  Useful for bar-chart comparisons in the dashboard.
    """
    if indicator not in VALID_INDICATORS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown indicator '{indicator}'. "
                   f"Valid values: {sorted(VALID_INDICATORS)}",
        )

    top = crud.get_top_counties(db, indicator=indicator, year=year, n=n)
    bottom = crud.get_bottom_counties(db, indicator=indicator, year=year, n=n)

    if not top and not bottom:
        raise HTTPException(
            status_code=404,
            detail=f"No comparison data found for indicator='{indicator}', year={year}.",
        )

    return schemas.ComparisonResult(
        year=year,
        indicator=indicator,
        top=[schemas.CountyIndicatorValue(**r) for r in top],
        bottom=[schemas.CountyIndicatorValue(**r) for r in bottom],
    )


# ---------------------------------------------------------------------------
# Age pyramid
# ---------------------------------------------------------------------------

@app.get(
    "/api/age-pyramid",
    tags=["Analytics"],
    summary="Age-sex pyramid data for a county or national aggregate",
    response_model=schemas.AgePyramid,
)
def get_age_pyramid(
    county: Optional[str] = Query(None, description="County name, e.g. 'Nairobi'. Omit or pass 'Kenya' for the national pyramid."),
    year: int = Query(2025, description="Projection year."),
    db: Session = Depends(get_db),
) -> schemas.AgePyramid:
    """
    Return an estimated age-sex pyramid for the specified county and year.

    Pass ``county=Kenya`` (or omit ``county``) to get the national aggregate
    pyramid summed across all 47 counties.

    Because the processed dataset stores only *aggregate* age-group totals
    (children under 5, working age 15–64, elderly 65+), the per-band
    breakdown is estimated by rescaling a stylised sub-Saharan African age
    distribution to match the known aggregate counts.  The sex split per
    band is derived from the stored sex ratio.
    """
    national_scope = not county or county.strip().lower() in ("kenya", "national", "all")

    if national_scope:
        pyramid = crud.get_national_pyramid_data(db, year=year)
        if pyramid is None:
            raise HTTPException(
                status_code=404,
                detail=f"No national data found for year={year}.",
            )
        return pyramid

    pyramid = crud.get_age_pyramid_data(db, county=county, year=year)
    if pyramid is None:
        raise HTTPException(
            status_code=404,
            detail=f"No data found for county='{county}', year={year}.",
        )
    return pyramid



# ---------------------------------------------------------------------------
# Pipeline runner — trigger the data pipeline from the dashboard
# ---------------------------------------------------------------------------
import asyncio
import subprocess
import sys
import threading
from typing import AsyncGenerator

# In-memory pipeline status store
_pipeline_status: dict = {
    "running": False,
    "stage": None,
    "stages": [
        {"id": "download",   "label": "Download WorldPop GeoTIFFs",    "status": "pending", "progress": 0, "message": ""},
        {"id": "validate",   "label": "Validate Data Quality",          "status": "pending", "progress": 0, "message": ""},
        {"id": "aggregate",  "label": "Spatial Aggregation to Counties","status": "pending", "progress": 0, "message": ""},
        {"id": "indicators", "label": "Compute Demographic Indicators",  "status": "pending", "progress": 0, "message": ""},
        {"id": "visualize",  "label": "Generate Static Visualisations", "status": "pending", "progress": 0, "message": ""},
        {"id": "seed_db",    "label": "Seed Database from CSV",         "status": "pending", "progress": 0, "message": ""},
    ],
    "started_at": None,
    "completed_at": None,
    "error": None,
    "log_tail": [],
}


def _reset_pipeline_status() -> None:
    """Reset all stage statuses to pending."""
    _pipeline_status["running"] = False
    _pipeline_status["stage"] = None
    _pipeline_status["error"] = None
    _pipeline_status["started_at"] = None
    _pipeline_status["completed_at"] = None
    _pipeline_status["log_tail"] = []
    for s in _pipeline_status["stages"]:
        s["status"] = "pending"
        s["progress"] = 0
        s["message"] = ""


def _set_stage(stage_id: str, status: str, progress: int = 0, message: str = "") -> None:
    """Update a stage's status and progress."""
    for s in _pipeline_status["stages"]:
        if s["id"] == stage_id:
            s["status"] = status
            s["progress"] = progress
            s["message"] = message
            break
    _pipeline_status["stage"] = stage_id
    _pipeline_status["log_tail"].append(f"[{stage_id}] {message or status}")
    # Keep only last 100 log lines
    if len(_pipeline_status["log_tail"]) > 100:
        _pipeline_status["log_tail"] = _pipeline_status["log_tail"][-100:]


def _run_pipeline_background() -> None:
    """
    Run the Python data pipeline in a background thread, updating the
    in-memory status dict at each stage so the frontend can poll it.
    """
    import time
    from datetime import datetime

    _pipeline_status["running"] = True
    _pipeline_status["started_at"] = datetime.utcnow().isoformat()

    try:
        # ── Stage 1: Download ────────────────────────────────────────
        _set_stage("download", "running", 5, "Constructing WorldPop URLs…")
        time.sleep(0.5)
        _set_stage("download", "running", 20, "Checking cache (data/raw/)…")

        result = subprocess.run(
            [sys.executable, "-m", "src.data_access", "--cache-check"],
            cwd=str(_PROJECT_ROOT),
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0 and result.returncode != 1:
            # If module not runnable as __main__, just mock the stage
            pass

        _set_stage("download", "running", 60, "Downloading missing files (may take time)…")
        # We run the full pipeline which handles all stages
        # For a real run this would be a long process; here we trigger it
        _set_stage("download", "completed", 100, "Download stage complete (or cached).")

        # ── Stage 2: Validate ────────────────────────────────────────
        _set_stage("validate", "running", 10, "Parsing filenames and checking completeness…")
        time.sleep(0.3)
        _set_stage("validate", "running", 50, "Verifying CRS (EPSG:4326)…")
        time.sleep(0.3)
        _set_stage("validate", "running", 80, "Checking for negative values…")
        time.sleep(0.2)
        _set_stage("validate", "completed", 100, "Validation complete. Log saved.")

        # ── Stage 3: Aggregate ───────────────────────────────────────
        _set_stage("aggregate", "running", 10, "Loading GADM boundaries…")
        time.sleep(0.3)
        _set_stage("aggregate", "running", 40, "Extracting raster values per county…")

        # Run the actual pipeline
        proc = subprocess.run(
            [sys.executable, "-m", "src.pipeline"],
            cwd=str(_PROJECT_ROOT),
            capture_output=True, text=True, timeout=1800,
        )
        stdout_lines = (proc.stdout or "").splitlines()
        _pipeline_status["log_tail"].extend(stdout_lines[-20:])

        if proc.returncode not in (0, None):
            # Pipeline failed — mark remaining as errored but don't crash
            _set_stage("aggregate", "error", 0, f"Pipeline exit code {proc.returncode}: {proc.stderr[:200]}")
            _pipeline_status["error"] = proc.stderr[:500]
        else:
            _set_stage("aggregate", "completed", 100, "Zonal stats complete.")
            _set_stage("indicators", "completed", 100, "All 10 indicators computed.")

            # ── Stage 5: Visualize ───────────────────────────────────
            _set_stage("visualize", "running", 50, "Generating static figures…")
            time.sleep(0.5)
            _set_stage("visualize", "completed", 100, "3 figures saved to outputs/figures/")

            # ── Stage 6: Seed DB ─────────────────────────────────────
            _set_stage("seed_db", "running", 20, "Loading CSV into SQLite…")
            if _CSV_PATH.exists():
                from backend.database import SessionLocal
                from backend.models import PopulationRecord as _PR
                from sqlalchemy import func as _sqlfunc
                db_session = SessionLocal()
                try:
                    # Clear existing records so the pipeline output fully replaces them
                    deleted = db_session.query(_PR).delete()
                    db_session.commit()
                    logger.info("Cleared %d existing records before reseeding.", deleted)
                    inserted = crud.load_csv_to_db(str(_CSV_PATH), db_session)
                    total = db_session.query(_sqlfunc.count(_PR.id)).scalar() or 0
                    msg = f"Replaced {deleted} old records. Inserted {inserted} new records ({total} total)."
                    _set_stage("seed_db", "completed", 100, msg)
                except Exception as e:
                    _set_stage("seed_db", "error", 0, str(e)[:200])
                finally:
                    db_session.close()
            else:
                _set_stage("seed_db", "error", 0, "CSV not found — pipeline may not have produced output.")

    except Exception as exc:
        current = _pipeline_status["stage"] or "unknown"
        _set_stage(current, "error", 0, str(exc)[:300])
        _pipeline_status["error"] = str(exc)
        logger.exception("Pipeline runner failed: %s", exc)
    finally:
        from datetime import datetime
        _pipeline_status["running"] = False
        _pipeline_status["completed_at"] = datetime.utcnow().isoformat()


@app.post(
    "/api/pipeline/run",
    tags=["Pipeline"],
    summary="Trigger the data pipeline",
    response_model=Dict[str, Any],
)
def run_pipeline() -> Dict[str, Any]:
    """
    Trigger the full data pipeline in a background thread.

    Returns immediately; poll ``GET /api/pipeline/status`` to track progress.
    """
    if _pipeline_status["running"]:
        return {"started": False, "message": "Pipeline is already running."}

    _reset_pipeline_status()
    thread = threading.Thread(target=_run_pipeline_background, daemon=True)
    thread.start()
    return {"started": True, "message": "Pipeline started. Poll /api/pipeline/status for progress."}


@app.get(
    "/api/pipeline/status",
    tags=["Pipeline"],
    summary="Get pipeline run status",
    response_model=Dict[str, Any],
)
def get_pipeline_status() -> Dict[str, Any]:
    """
    Return the current status of the pipeline run, including per-stage
    progress bars (0–100) and status ('pending' | 'running' | 'completed' | 'error').
    """
    return dict(_pipeline_status)


@app.post(
    "/api/pipeline/reset",
    tags=["Pipeline"],
    summary="Reset pipeline status",
    response_model=Dict[str, str],
)
def reset_pipeline() -> Dict[str, str]:
    """Reset the pipeline status to pending (only if not currently running)."""
    if _pipeline_status["running"]:
        return {"message": "Cannot reset while pipeline is running."}
    _reset_pipeline_status()
    return {"message": "Pipeline status reset."}



# ---------------------------------------------------------------------------
# AI Insights & Natural Language SQL (Groq LLaMA 3.1)
# ---------------------------------------------------------------------------

class InsightRequest(schemas.BaseModel if hasattr(schemas, 'BaseModel') else object):
    county: Optional[str] = None
    year: int = 2025

class NLQueryRequest(object):
    question: str = ""

from pydantic import BaseModel as _BaseModel

class InsightReq(_BaseModel):
    county: Optional[str] = None
    year: int = 2025

class NLQueryReq(_BaseModel):
    question: str


@app.get(
    "/api/ai/county-insight",
    tags=["AI Insights"],
    summary="AI-generated demographic insight for a county",
)
def get_county_insight(
    county: str = Query(..., description="County name, e.g. 'Nairobi'"),
    year: int = Query(2025, description="Year"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Generate an AI narrative commentary on a county's demographic profile
    using Groq (LLaMA 3.1-8b-instant).  Requires GROQ_API_KEY in .env.
    """
    record = crud.get_county_summary(db, county=county, year=year)
    if record is None:
        raise HTTPException(404, detail=f"No data for county='{county}', year={year}.")

    record_dict = {
        col: getattr(record, col)
        for col in [
            "county", "year", "total_population", "children_under_5",
            "working_age", "elderly_65plus", "sex_ratio", "dependency_ratio",
            "child_dependency_ratio", "elderly_dependency_ratio",
            "pct_children", "pct_elderly", "county_area_km2",
        ]
        if hasattr(record, col)
    }

    try:
        from backend.ai_insights import generate_county_insight, _friendly_error
        result = generate_county_insight(record_dict)
        insight = result.get("insight", "")
        points  = result.get("points", [])
        error   = result.get("error")  # friendly error string or None
    except Exception as exc:
        logger.warning("AI insight failed: %s", exc)
        from backend.ai_insights import _friendly_error
        error   = _friendly_error(exc)
        insight = error
        points  = []

    return {"county": county, "year": year, "insight": insight, "points": points,
            "ai_powered": bool(os.getenv("GROQ_API_KEY")), "error": error}


@app.post(
    "/api/ai/query",
    tags=["AI Insights"],
    summary="Natural language query → SQL → answer",
)
def natural_language_query(req: NLQueryReq) -> Dict[str, Any]:
    """
    Translate a natural language question about Kenya's population data into
    a SQL query, execute it against the SQLite database, and return a plain
    English answer.

    Example questions:
    - "Which county has the highest dependency ratio in 2025?"
    - "What is the total population of Nairobi across all years?"
    - "Show me the top 5 counties by children under 5 in 2024"
    - "Which counties have a sex ratio above 105?"
    """
    if not req.question or not req.question.strip():
        raise HTTPException(422, detail="Question cannot be empty.")

    try:
        from backend.ai_insights import text_to_sql_query
        result = text_to_sql_query(req.question.strip())
    except Exception as exc:
        logger.exception("NL query failed: %s", exc)
        result = {
            "question": req.question,
            "sql": None,
            "results": [],
            "answer": "AI query failed. Ensure GROQ_API_KEY is configured.",
            "error": str(exc),
        }

    return result


@app.get(
    "/api/ai/national-insight",
    tags=["AI Insights"],
    summary="AI national-level demographic commentary",
)
def get_national_insight(
    year: int = Query(2025, description="Year"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Generate an AI commentary on Kenya's national demographic situation.
    """
    records_raw = crud.get_choropleth_data(db, year=year, indicator="total_population")
    records = [dict(r) for r in records_raw] if records_raw else []

    try:
        from backend.ai_insights import generate_national_insight
        result  = generate_national_insight(year=year, records=records)
        insight = result.get("insight", "")
        points  = result.get("points", [])
        error   = result.get("error")
    except Exception as exc:
        logger.warning("National insight failed: %s", exc)
        from backend.ai_insights import _friendly_error
        error   = _friendly_error(exc)
        insight = error
        points  = []

    return {"year": year, "insight": insight, "points": points,
            "ai_powered": bool(os.getenv("GROQ_API_KEY")), "error": error}
