"""
crud.py
-------
Database CRUD helpers and analytics query functions for the Ahadi Kenya
Population Analytics backend.

All functions accept a SQLAlchemy ``Session`` as their first argument so
they remain unit-testable and independent of FastAPI's dependency injection.
"""

from __future__ import annotations

import logging
import math
import os
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from backend.models import PopulationRecord
from backend import schemas

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Ordered standard age bands used for the mock age pyramid reconstruction.
_AGE_BANDS = [
    "0-4", "5-9", "10-14", "15-19", "20-24",
    "25-29", "30-34", "35-39", "40-44", "45-49",
    "50-54", "55-59", "60-64", "65-69", "70-74",
    "75-79", "80+",
]

# Approximate share of each 5-year age band within a "typical" sub-Saharan
# African population (used only when per-age-group data are unavailable).
# Source: stylised WorldPop Kenya 2020 national age structure, normalised.
_TYPICAL_AGE_SHARE: Dict[str, float] = {
    "0-4":   0.163, "5-9":   0.148, "10-14": 0.133,
    "15-19": 0.113, "20-24": 0.093, "25-29": 0.076,
    "30-34": 0.062, "35-39": 0.051, "40-44": 0.040,
    "45-49": 0.032, "50-54": 0.025, "55-59": 0.019,
    "60-64": 0.014, "65-69": 0.010, "70-74": 0.007,
    "75-79": 0.004, "80+":   0.010,
}

# Indicators exposed to the API (key → label, unit, description).
INDICATOR_META: List[Dict[str, Optional[str]]] = [
    {
        "key": "total_population",
        "label": "Total Population",
        "unit": "persons",
        "description": "Sum of all age groups, both sexes.",
    },
    {
        "key": "children_under_5",
        "label": "Children Under 5",
        "unit": "persons",
        "description": "Population aged 0–4, both sexes.",
    },
    {
        "key": "working_age",
        "label": "Working-Age Population",
        "unit": "persons",
        "description": "Population aged 15–64, both sexes.",
    },
    {
        "key": "elderly_65plus",
        "label": "Elderly (65+)",
        "unit": "persons",
        "description": "Population aged 65 and above, both sexes.",
    },
    {
        "key": "sex_ratio",
        "label": "Sex Ratio",
        "unit": "males per 100 females",
        "description": "Male population ÷ female population × 100.",
    },
    {
        "key": "dependency_ratio",
        "label": "Dependency Ratio",
        "unit": "per 100 working-age",
        "description": "(Children + elderly) ÷ working-age × 100.",
    },
    {
        "key": "child_dependency_ratio",
        "label": "Child Dependency Ratio",
        "unit": "per 100 working-age",
        "description": "Children under 5 ÷ working-age × 100.",
    },
    {
        "key": "elderly_dependency_ratio",
        "label": "Elderly Dependency Ratio",
        "unit": "per 100 working-age",
        "description": "Elderly (65+) ÷ working-age × 100.",
    },
    {
        "key": "pct_children",
        "label": "% Children Under 5",
        "unit": "%",
        "description": "Children under 5 as a percentage of total population.",
    },
    {
        "key": "pct_elderly",
        "label": "% Elderly (65+)",
        "unit": "%",
        "description": "Elderly (65+) as a percentage of total population.",
    },
    {
        "key": "county_area_km2",
        "label": "County Area",
        "unit": "km²",
        "description": "Approximate county area in square kilometres.",
    },
]

# Set of valid indicator column names for quick validation.
VALID_INDICATORS: set[str] = {m["key"] for m in INDICATOR_META}  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _safe_float(value: Any) -> Optional[float]:
    """Return a float or None, converting NaN to None."""
    if value is None:
        return None
    try:
        f = float(value)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def get_all_counties(db: Session) -> List[str]:
    """
    Return an alphabetically sorted list of distinct county names.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.

    Returns
    -------
    List[str]
        Sorted county names found in the database.
    """
    rows = (
        db.query(PopulationRecord.county)
        .distinct()
        .order_by(PopulationRecord.county)
        .all()
    )
    return [r[0] for r in rows]


def get_all_years(db: Session) -> List[int]:
    """
    Return a sorted list of distinct projection years.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.

    Returns
    -------
    List[int]
        Sorted years found in the database.
    """
    rows = (
        db.query(PopulationRecord.year)
        .distinct()
        .order_by(PopulationRecord.year)
        .all()
    )
    return [r[0] for r in rows]


def get_records(
    db: Session,
    county: Optional[str] = None,
    year: Optional[int] = None,
    indicator: Optional[str] = None,
) -> List[PopulationRecord]:
    """
    Return population records, optionally filtered by county, year, and/or
    the presence of a non-NULL indicator value.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    county : str, optional
        Filter to a specific county (case-insensitive substring match).
    year : int, optional
        Filter to a specific projection year.
    indicator : str, optional
        If provided, only records where this column is not NULL are returned.

    Returns
    -------
    List[PopulationRecord]
        Matching ORM model instances.
    """
    q = db.query(PopulationRecord)

    if county:
        q = q.filter(PopulationRecord.county.ilike(f"%{county}%"))
    if year is not None:
        q = q.filter(PopulationRecord.year == year)
    if indicator and indicator in VALID_INDICATORS:
        col = getattr(PopulationRecord, indicator, None)
        if col is not None:
            q = q.filter(col.isnot(None))

    return q.order_by(PopulationRecord.county, PopulationRecord.year).all()


def get_county_summary(
    db: Session,
    county: str,
    year: int,
) -> Optional[PopulationRecord]:
    """
    Return the full demographic record for a single county × year combination.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    county : str
        Exact county name (case-insensitive).
    year : int
        Projection year.

    Returns
    -------
    PopulationRecord or None
        The matching record, or ``None`` if not found.
    """
    return (
        db.query(PopulationRecord)
        .filter(
            func.lower(PopulationRecord.county) == county.lower(),
            PopulationRecord.year == year,
        )
        .first()
    )


def get_national_timeseries(
    db: Session,
    indicator: str = "total_population",
) -> List[Dict[str, Any]]:
    """
    Return a national-level timeseries by summing ``indicator`` across all
    counties for each year.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    indicator : str
        Column name to aggregate.  Defaults to ``total_population``.

    Returns
    -------
    List[dict]
        Each element has keys ``year`` (int) and ``value`` (float | None).
    """
    if indicator not in VALID_INDICATORS:
        indicator = "total_population"

    col = getattr(PopulationRecord, indicator)
    rows = (
        db.query(
            PopulationRecord.year,
            func.sum(col).label("value"),
        )
        .group_by(PopulationRecord.year)
        .order_by(PopulationRecord.year)
        .all()
    )
    return [{"year": r.year, "value": _safe_float(r.value)} for r in rows]


def get_county_timeseries(
    db: Session,
    county: str,
    indicator: str = "total_population",
) -> List[Dict[str, Any]]:
    """
    Return a per-county timeseries for ``indicator`` across all years.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    county : str
        County name (case-insensitive).
    indicator : str
        Column name to return.

    Returns
    -------
    List[dict]
        Each element has keys ``year`` and ``value``.
    """
    if indicator not in VALID_INDICATORS:
        indicator = "total_population"

    col = getattr(PopulationRecord, indicator)
    rows = (
        db.query(PopulationRecord.year, col.label("value"))
        .filter(func.lower(PopulationRecord.county) == county.lower())
        .order_by(PopulationRecord.year)
        .all()
    )
    return [{"year": r.year, "value": _safe_float(r.value)} for r in rows]


def get_top_counties(
    db: Session,
    indicator: str,
    year: int,
    n: int = 10,
) -> List[Dict[str, Any]]:
    """
    Return the top-N counties ranked *descending* by ``indicator`` for ``year``.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    indicator : str
        Column name to rank by.
    year : int
        Projection year to filter to.
    n : int
        Number of counties to return (default 10).

    Returns
    -------
    List[dict]
        Each element has keys ``county`` (str) and ``value`` (float | None).
    """
    if indicator not in VALID_INDICATORS:
        raise ValueError(f"Unknown indicator: {indicator!r}")

    col = getattr(PopulationRecord, indicator)
    rows = (
        db.query(PopulationRecord.county, col.label("value"))
        .filter(PopulationRecord.year == year, col.isnot(None))
        .order_by(col.desc())
        .limit(n)
        .all()
    )
    return [{"county": r.county, "value": _safe_float(r.value)} for r in rows]


def get_bottom_counties(
    db: Session,
    indicator: str,
    year: int,
    n: int = 10,
) -> List[Dict[str, Any]]:
    """
    Return the bottom-N counties ranked *ascending* by ``indicator`` for ``year``.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    indicator : str
        Column name to rank by.
    year : int
        Projection year to filter to.
    n : int
        Number of counties to return (default 10).

    Returns
    -------
    List[dict]
        Each element has keys ``county`` (str) and ``value`` (float | None).
    """
    if indicator not in VALID_INDICATORS:
        raise ValueError(f"Unknown indicator: {indicator!r}")

    col = getattr(PopulationRecord, indicator)
    rows = (
        db.query(PopulationRecord.county, col.label("value"))
        .filter(PopulationRecord.year == year, col.isnot(None))
        .order_by(col.asc())
        .limit(n)
        .all()
    )
    return [{"county": r.county, "value": _safe_float(r.value)} for r in rows]


def get_choropleth_data(
    db: Session,
    year: int,
    indicator: str = "total_population",
) -> List[Dict[str, Any]]:
    """
    Return county names paired with a single indicator value for the given
    year, suitable for joining with GeoJSON features in the choropleth endpoint.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    year : int
        Projection year.
    indicator : str
        Column name to return per county.

    Returns
    -------
    List[dict]
        Each element has keys ``county`` and ``value`` plus a selection of
        summary tooltip fields.
    """
    if indicator not in VALID_INDICATORS:
        indicator = "total_population"

    rows = (
        db.query(PopulationRecord)
        .filter(PopulationRecord.year == year)
        .all()
    )

    result: List[Dict[str, Any]] = []
    for r in rows:
        result.append({
            "county": r.county,
            "value": _safe_float(getattr(r, indicator)),
            "total_population": _safe_float(r.total_population),
            "dependency_ratio": _safe_float(r.dependency_ratio),
            "sex_ratio": _safe_float(r.sex_ratio),
            "pct_children": _safe_float(r.pct_children),
            "pct_elderly": _safe_float(r.pct_elderly),
        })
    return result


def get_age_pyramid_data(
    db: Session,
    county: str,
    year: int,
) -> Optional[schemas.AgePyramid]:
    """
    Return an age-sex pyramid for a county × year combination.

    Because the processed CSV stores only aggregate indicators (no per-age-
    group breakdown), the individual age bands are *estimated* using a
    stylised sub-Saharan African age distribution scaled to the known
    aggregate totals (children_under_5, working_age, elderly_65plus).
    The sex split within each band is derived from the stored sex_ratio.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy database session.
    county : str
        County name (case-insensitive).
    year : int
        Projection year.

    Returns
    -------
    AgePyramid or None
        Estimated age-sex pyramid, or ``None`` if no record is found.
    """
    record = get_county_summary(db, county, year)
    if record is None:
        return None

    total = record.total_population or 0.0
    children = record.children_under_5 or 0.0
    working = record.working_age or 0.0
    elderly = record.elderly_65plus or 0.0
    sex_ratio = record.sex_ratio or 100.0  # default to balanced if unknown

    # Fraction of males in this county (sex_ratio = males / females × 100).
    # Let r = sex_ratio/100.  male_frac = r / (1 + r).
    r = sex_ratio / 100.0
    male_frac = r / (1.0 + r)
    female_frac = 1.0 - male_frac

    # Map each age band to one of the three aggregate groups.
    _band_to_group: Dict[str, str] = {
        "0-4": "children",
        "5-9": "working", "10-14": "working",
        "15-19": "working", "20-24": "working", "25-29": "working",
        "30-34": "working", "35-39": "working", "40-44": "working",
        "45-49": "working", "50-54": "working", "55-59": "working",
        "60-64": "working",
        "65-69": "elderly", "70-74": "elderly",
        "75-79": "elderly", "80+": "elderly",
    }

    # Group-level totals and the shares that belong to each group.
    group_totals = {"children": children, "working": working, "elderly": elderly}
    group_band_shares: Dict[str, Dict[str, float]] = {
        "children": {}, "working": {}, "elderly": {},
    }
    for band, grp in _band_to_group.items():
        group_band_shares[grp][band] = _TYPICAL_AGE_SHARE[band]

    # Normalise shares within each group so they sum to 1.
    for grp, bands in group_band_shares.items():
        total_share = sum(bands.values())
        if total_share > 0:
            for band in bands:
                group_band_shares[grp][band] /= total_share

    age_groups: List[schemas.AgeGroup] = []
    for band in _AGE_BANDS:
        grp = _band_to_group[band]
        grp_total = group_totals[grp]
        band_total = grp_total * group_band_shares[grp].get(band, 0.0)

        age_groups.append(
            schemas.AgeGroup(
                age_group=band,
                male=round(band_total * male_frac, 1),
                female=round(band_total * female_frac, 1),
            )
        )

    return schemas.AgePyramid(county=record.county, year=year, age_groups=age_groups)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_csv_to_db(csv_path: str, db: Session) -> int:
    """
    Load the processed population CSV produced by the data pipeline into the
    SQLite database, skipping rows that already exist (county × year).

    Parameters
    ----------
    csv_path : str
        Absolute or relative path to ``kenya_population_by_county.csv``.
    db : Session
        Active SQLAlchemy database session.

    Returns
    -------
    int
        Number of rows inserted.

    Raises
    ------
    FileNotFoundError
        If ``csv_path`` does not exist.
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = pd.read_csv(csv_path)
    logger.info("CSV loaded: %d rows, columns: %s", len(df), list(df.columns))

    # Normalise column names to lowercase and strip whitespace.
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    # Determine which (county, year) pairs are already in the DB.
    existing: set[tuple[str, int]] = {
        (r[0], r[1])
        for r in db.query(PopulationRecord.county, PopulationRecord.year).all()
    }

    inserted = 0
    for _, row in df.iterrows():
        county = str(row.get("county", "")).strip()
        try:
            year = int(row.get("year", 0))
        except (TypeError, ValueError):
            logger.warning("Skipping row with invalid year: %s", row.to_dict())
            continue

        if not county or (county, year) in existing:
            continue

        record = PopulationRecord(
            county=county,
            year=year,
            total_population=_safe_float(row.get("total_population")),
            children_under_5=_safe_float(row.get("children_under_5")),
            working_age=_safe_float(row.get("working_age")),
            elderly_65plus=_safe_float(row.get("elderly_65plus")),
            sex_ratio=_safe_float(row.get("sex_ratio")),
            dependency_ratio=_safe_float(row.get("dependency_ratio")),
            child_dependency_ratio=_safe_float(row.get("child_dependency_ratio")),
            elderly_dependency_ratio=_safe_float(row.get("elderly_dependency_ratio")),
            pct_children=_safe_float(row.get("pct_children")),
            pct_elderly=_safe_float(row.get("pct_elderly")),
            county_area_km2=_safe_float(row.get("county_area_km2")),
        )
        db.add(record)
        existing.add((county, year))
        inserted += 1

    db.commit()
    logger.info("Inserted %d new records from CSV.", inserted)
    return inserted
