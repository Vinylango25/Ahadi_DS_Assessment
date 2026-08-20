"""
schemas.py
----------
Pydantic request/response schemas for the Ahadi Kenya Population Analytics
backend API.

All schemas that mirror ORM models use ``model_config = ConfigDict(from_attributes=True)``
(the Pydantic v2 equivalent of ``orm_mode = True``) so they can be constructed
directly from SQLAlchemy model instances.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Population Record schemas
# ---------------------------------------------------------------------------

class PopulationRecordBase(BaseModel):
    """Shared fields for reading and creating population records."""

    county: str = Field(..., description="County name (GADM Level-2).")
    year: int = Field(..., ge=2000, le=2100, description="Projection year.")
    total_population: Optional[float] = Field(None, description="Total population (all ages, both sexes).")
    children_under_5: Optional[float] = Field(None, description="Population aged 0–4.")
    working_age: Optional[float] = Field(None, description="Population aged 15–64.")
    elderly_65plus: Optional[float] = Field(None, description="Population aged 65+.")
    sex_ratio: Optional[float] = Field(None, description="Male / female × 100.")
    dependency_ratio: Optional[float] = Field(None, description="(children + elderly) / working-age × 100.")
    child_dependency_ratio: Optional[float] = Field(None, description="children / working-age × 100.")
    elderly_dependency_ratio: Optional[float] = Field(None, description="elderly / working-age × 100.")
    pct_children: Optional[float] = Field(None, description="% of total that are children under 5.")
    pct_elderly: Optional[float] = Field(None, description="% of total that are elderly 65+.")
    county_area_km2: Optional[float] = Field(None, description="County area in km².")


class PopulationRecordCreate(PopulationRecordBase):
    """Schema used when inserting a new population record."""
    pass


class PopulationRecord(PopulationRecordBase):
    """Full population record as returned by the API (includes primary key)."""

    id: int = Field(..., description="Auto-generated primary key.")

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Filter / query parameter schema
# ---------------------------------------------------------------------------

class Filters(BaseModel):
    """
    Optional query filters accepted by several endpoints.

    All fields are optional — omitting a field means *no filter* on that
    dimension.
    """

    county: Optional[str] = Field(None, description="Filter by county name.")
    year: Optional[int] = Field(None, ge=2000, le=2100, description="Filter by projection year.")
    sex: Optional[str] = Field(
        None,
        description="Sex to display: 'male', 'female', or 'total'.",
        pattern="^(male|female|total)$",
    )
    indicator: Optional[str] = Field(
        None,
        description="Demographic indicator column name, e.g. 'dependency_ratio'.",
    )


# ---------------------------------------------------------------------------
# County summary schema
# ---------------------------------------------------------------------------

class CountySummary(BaseModel):
    """
    All demographic metrics for a single county × year combination,
    returned by ``GET /api/county/{county}``.
    """

    county: str
    year: int
    total_population: Optional[float] = None
    children_under_5: Optional[float] = None
    working_age: Optional[float] = None
    elderly_65plus: Optional[float] = None
    sex_ratio: Optional[float] = None
    dependency_ratio: Optional[float] = None
    child_dependency_ratio: Optional[float] = None
    elderly_dependency_ratio: Optional[float] = None
    pct_children: Optional[float] = None
    pct_elderly: Optional[float] = None
    county_area_km2: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# National / county timeseries schema
# ---------------------------------------------------------------------------

class TimeseriesPoint(BaseModel):
    """A single year-value observation in a timeseries."""

    year: int
    value: Optional[float] = None


class NationalTimeseries(BaseModel):
    """
    Timeseries of a demographic indicator for the whole country or a specific
    county, returned by ``GET /api/timeseries``.
    """

    scope: str = Field(..., description="'Kenya' for national or a county name.")
    indicator: str = Field(..., description="Indicator column name.")
    data: List[TimeseriesPoint] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Age pyramid schema
# ---------------------------------------------------------------------------

class AgeGroup(BaseModel):
    """Population counts for a single age band, split by sex."""

    age_group: str = Field(..., description="Age band label, e.g. '0-4'.")
    male: float = Field(0.0, description="Male population for this age band.")
    female: float = Field(0.0, description="Female population for this age band.")


class AgePyramid(BaseModel):
    """
    Age-sex pyramid data for a county × year combination, returned by
    ``GET /api/age-pyramid``.

    Because the processed CSV does not store per-age-group breakdowns, the
    age groups are *reconstructed / estimated* from the aggregate indicators
    (total, children_under_5, working_age, elderly_65plus) and an assumed
    sex ratio.  They should be treated as illustrative rather than precise.
    """

    county: str
    year: int
    age_groups: List[AgeGroup] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Comparison schema (top / bottom counties bar chart)
# ---------------------------------------------------------------------------

class CountyIndicatorValue(BaseModel):
    """A county name paired with a single indicator value."""

    county: str
    value: Optional[float] = None


class ComparisonResult(BaseModel):
    """
    Top-N and bottom-N counties ranked by a demographic indicator for a given
    year, returned by ``GET /api/comparison``.
    """

    year: int
    indicator: str
    top: List[CountyIndicatorValue] = Field(default_factory=list)
    bottom: List[CountyIndicatorValue] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Choropleth / GeoJSON feature property schema
# ---------------------------------------------------------------------------

class ChoroplethFeatureProperties(BaseModel):
    """
    Properties embedded in each GeoJSON feature returned by
    ``GET /api/choropleth``.
    """

    county: str
    value: Optional[float] = None
    total_population: Optional[float] = None
    dependency_ratio: Optional[float] = None
    sex_ratio: Optional[float] = None
    pct_children: Optional[float] = None
    pct_elderly: Optional[float] = None


# ---------------------------------------------------------------------------
# Generic list-response wrappers
# ---------------------------------------------------------------------------

class StringListResponse(BaseModel):
    """Wrapper for a simple list of strings (counties, years, etc.)."""

    data: List[str]


class IndicatorMeta(BaseModel):
    """Metadata for a single demographic indicator."""

    key: str = Field(..., description="Column name in the database.")
    label: str = Field(..., description="Human-readable label for UI display.")
    unit: Optional[str] = Field(None, description="Unit of measurement, e.g. '%' or 'per 100'.")
    description: Optional[str] = Field(None, description="Short description for tooltip/help text.")


class IndicatorsResponse(BaseModel):
    """List of all available demographic indicators with metadata."""

    indicators: List[IndicatorMeta]
