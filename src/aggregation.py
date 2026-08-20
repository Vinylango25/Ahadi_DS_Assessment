"""
aggregation.py — Zonal statistics and demographic indicator calculation.

Provides functions to:
- Mask a raster to each county polygon and sum population pixels.
- Aggregate individual age-sex raster bands into county-level DataFrames.
- Compute a full suite of demographic indicators from aggregated counts.
- Save the final dataset to data/processed/kenya_population_by_county.csv.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import rasterio.mask
from rasterio.crs import CRS
from shapely.geometry import mapping

from utils import (
    PROCESSED_DATA_DIR,
    SUPPORTED_AGES,
    SUPPORTED_SEXES,
    SUPPORTED_YEARS,
    ensure_directory,
    parse_worldpop_filename,
    setup_logging,
    build_worldpop_filename,
    build_worldpop_total_filename,
)

# ---------------------------------------------------------------------------
# Module logger
# ---------------------------------------------------------------------------

logger = setup_logging("ahadi.aggregation")

# ---------------------------------------------------------------------------
# Age-group definitions for demographic indicators
# ---------------------------------------------------------------------------

# Children under 5: age-group starts 0 and 1
AGES_CHILDREN: List[int] = [0, 1]

# Working-age population: 15–64 (i.e. age-group starts 15 through 60)
AGES_WORKING: List[int] = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

# Elderly 65+: age-group starts 65, 70, 75, 80, 85, 90
AGES_ELDERLY: List[int] = [65, 70, 75, 80, 85, 90]

# Output CSV filename
OUTPUT_CSV_NAME = "kenya_population_by_county.csv"


# ---------------------------------------------------------------------------
# Zonal statistics (raster → polygon)
# ---------------------------------------------------------------------------

def zonal_sum(raster_path: Path, gdf: gpd.GeoDataFrame) -> np.ndarray:
    """Compute the sum of raster pixel values within each polygon in *gdf*.

    Uses :func:`rasterio.mask.mask` to clip the raster to each feature's
    geometry, then sums all valid (non-no-data) pixels.  Pixels with values
    ≤ 0 are treated as valid unless the raster reports a no-data value.

    Args:
        raster_path: Path to a single-band ``.tif`` raster in EPSG:4326.
        gdf:         GeoDataFrame of county polygons, also in EPSG:4326.

    Returns:
        1-D NumPy array of float64 sums, one element per row in *gdf*.

    Raises:
        FileNotFoundError: If *raster_path* does not exist.
        rasterio.errors.RasterioIOError: On raster read failure.
    """
    if not raster_path.exists():
        raise FileNotFoundError(f"Raster not found: {raster_path}")

    sums = np.zeros(len(gdf), dtype=np.float64)

    try:
        with rasterio.open(raster_path) as src:
            nodata = src.nodata

            for idx, geom in enumerate(gdf.geometry):
                try:
                    out_image, _ = rasterio.mask.mask(
                        src,
                        [mapping(geom)],
                        crop=True,
                        nodata=nodata if nodata is not None else np.nan,
                        all_touched=False,
                    )
                    band = out_image[0].astype(np.float64)

                    # Mask out no-data
                    if nodata is not None:
                        band = np.where(band == nodata, np.nan, band)

                    # Sum valid pixels (ignore NaN)
                    pixel_sum = float(np.nansum(band[band > -9999]))
                    sums[idx] = max(pixel_sum, 0.0)  # clamp to 0

                except Exception as exc:
                    logger.warning(
                        "Could not mask raster for polygon %d: %s — treating as 0.",
                        idx, exc,
                    )
                    sums[idx] = 0.0

    except rasterio.errors.RasterioIOError as exc:
        logger.error("Failed to open raster '%s': %s", raster_path, exc)
        raise

    return sums


# ---------------------------------------------------------------------------
# Per-year aggregation
# ---------------------------------------------------------------------------

def aggregate_year(
    year: int,
    available_files: List[Path],
    gdf: gpd.GeoDataFrame,
    county_col: str = "NAME_1",
) -> pd.DataFrame:
    """Aggregate all age-sex rasters for *year* into a county-level DataFrame.

    Iterates over every (sex, age) combination, runs zonal statistics, and
    builds a wide DataFrame with one column per ``{sex}_{age}`` combination
    (e.g. ``m_0``, ``f_0``, ``m_1``, …).

    Args:
        year:            The reference year to process.
        available_files: List of all locally available TIF files.
        gdf:             County polygon GeoDataFrame (EPSG:4326).
        county_col:      Column in *gdf* containing county names.

    Returns:
        DataFrame indexed by county name with one population column per
        age-sex group (e.g. ``pop_m_0``, ``pop_f_0``, …) plus a
        ``year`` column.
    """
    logger.info("Aggregating rasters for year %d…", year)

    # Build filename → path lookup for quick access
    file_index: Dict[str, Path] = {p.name: p for p in available_files}

    # Start from county names
    county_names = gdf[county_col].tolist() if county_col in gdf.columns else list(range(len(gdf)))
    rows: Dict[str, np.ndarray] = {"county": np.array(county_names)}

    for sex in SUPPORTED_SEXES:
        for age in SUPPORTED_AGES:
            filename = build_worldpop_filename(sex, age, year)
            col = f"pop_{sex}_{age}"

            if filename not in file_index:
                logger.warning("Missing raster for %s — filling column '%s' with NaN.", filename, col)
                rows[col] = np.full(len(gdf), np.nan)
                continue

            try:
                sums = zonal_sum(file_index[filename], gdf)
                rows[col] = sums
                logger.debug("Completed zonal stats: %s (total=%.0f)", filename, sums.sum())
            except Exception as exc:
                logger.error("Zonal stats failed for '%s': %s — using NaN.", filename, exc)
                rows[col] = np.full(len(gdf), np.nan)

    df = pd.DataFrame(rows)
    df["year"] = year
    logger.info("Year %d aggregation complete. Shape: %s.", year, df.shape)
    return df


# ---------------------------------------------------------------------------
# Demographic indicator calculation
# ---------------------------------------------------------------------------

def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Compute all required demographic indicators from raw age-sex counts.

    Expects columns named ``pop_{sex}_{age}`` (e.g. ``pop_m_0``,
    ``pop_f_80``) as produced by :func:`aggregate_year`.

    Derived indicators added:

    ========================  =============================================
    Column                    Formula
    ========================  =============================================
    ``male_total``            sum of all male age groups
    ``female_total``          sum of all female age groups
    ``total_population``      male_total + female_total
    ``children_under_5``      pop_{m,f}_{0,1} summed
    ``working_age``           pop_{m,f}_{15…60} summed
    ``elderly_65plus``        pop_{m,f}_{65,70,75,80,85,90} summed
    ``sex_ratio``             male_total / female_total × 100
    ``dependency_ratio``      (children + elderly) / working_age × 100
    ``child_dependency_ratio``children / working_age × 100
    ``elderly_dependency_ratio``elderly / working_age × 100
    ``pct_children``          children_under_5 / total_population × 100
    ``pct_elderly``           elderly_65plus / total_population × 100
    ========================  =============================================

    Args:
        df: DataFrame with ``pop_{sex}_{age}`` columns (one row per county
            per year).

    Returns:
        The same DataFrame with all indicator columns appended in-place.
    """
    logger.info("Calculating demographic indicators…")

    def _sum_cols(sexes: List[str], ages: List[int]) -> pd.Series:
        """Sum all matching pop_{sex}_{age} columns; missing cols → 0."""
        cols = [f"pop_{s}_{a}" for s in sexes for a in ages]
        present = [c for c in cols if c in df.columns]
        if not present:
            return pd.Series(np.zeros(len(df)), index=df.index)
        return df[present].fillna(0).sum(axis=1)

    # Sub-totals by sex
    df["male_total"] = _sum_cols(["m"], SUPPORTED_AGES)
    df["female_total"] = _sum_cols(["f"], SUPPORTED_AGES)
    df["total_population"] = df["male_total"] + df["female_total"]

    # Age-group aggregates (both sexes)
    df["children_under_5"] = _sum_cols(["m", "f"], AGES_CHILDREN)
    df["working_age"] = _sum_cols(["m", "f"], AGES_WORKING)
    df["elderly_65plus"] = _sum_cols(["m", "f"], AGES_ELDERLY)

    # --- Ratios (safe divide: 0 denominator → NaN) -----------------------

    def _safe_div(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
        return numerator.where(denominator > 0, other=np.nan) / denominator.where(denominator > 0)

    df["sex_ratio"] = _safe_div(df["male_total"], df["female_total"]) * 100

    dependants = df["children_under_5"] + df["elderly_65plus"]
    df["dependency_ratio"] = _safe_div(dependants, df["working_age"]) * 100
    df["child_dependency_ratio"] = _safe_div(df["children_under_5"], df["working_age"]) * 100
    df["elderly_dependency_ratio"] = _safe_div(df["elderly_65plus"], df["working_age"]) * 100

    df["pct_children"] = _safe_div(df["children_under_5"], df["total_population"]) * 100
    df["pct_elderly"] = _safe_div(df["elderly_65plus"], df["total_population"]) * 100

    # Round continuous indicators to 2 dp for readability
    ratio_cols = [
        "sex_ratio", "dependency_ratio", "child_dependency_ratio",
        "elderly_dependency_ratio", "pct_children", "pct_elderly",
    ]
    df[ratio_cols] = df[ratio_cols].round(2)

    logger.info("Indicator calculation complete.")
    return df


# ---------------------------------------------------------------------------
# County area
# ---------------------------------------------------------------------------

def add_county_area(df: pd.DataFrame, gdf: gpd.GeoDataFrame, county_col: str = "NAME_1") -> pd.DataFrame:
    """Append a ``county_area_km2`` column by computing polygon areas.

    Reprojects *gdf* to an equal-area projection (EPSG:6933) before
    computing areas so that km² values are accurate.

    Args:
        df:         Aggregated county DataFrame (must have a ``county`` column).
        gdf:        County GeoDataFrame in EPSG:4326.
        county_col: Column in *gdf* containing county names.

    Returns:
        DataFrame with ``county_area_km2`` column appended.
    """
    try:
        gdf_ea = gdf.to_crs(epsg=6933)  # Equal-area
        area_series = gdf_ea.geometry.area / 1e6  # m² → km²
        area_df = pd.DataFrame({
            "county": gdf[county_col].tolist() if county_col in gdf.columns else list(range(len(gdf))),
            "county_area_km2": area_series.values,
        })
        df = df.merge(area_df, on="county", how="left")
        logger.info("County areas computed and merged.")
    except Exception as exc:
        logger.warning("Could not compute county areas: %s — column omitted.", exc)

    return df


# ---------------------------------------------------------------------------
# Save output
# ---------------------------------------------------------------------------

def save_to_csv(df: pd.DataFrame, output_path: Optional[Path] = None) -> Path:
    """Persist the aggregated DataFrame to CSV.

    Args:
        df:          DataFrame to save.
        output_path: Destination path. Defaults to
                     ``data/processed/kenya_population_by_county.csv``.

    Returns:
        The path where the CSV was written.
    """
    if output_path is None:
        output_path = PROCESSED_DATA_DIR / OUTPUT_CSV_NAME

    ensure_directory(output_path.parent)
    df.to_csv(output_path, index=False, float_format="%.4f")
    logger.info("Saved aggregated data to '%s' (%d rows, %d columns).",
                output_path, len(df), len(df.columns))
    return output_path


# ---------------------------------------------------------------------------
# High-level entry point
# ---------------------------------------------------------------------------

def run_aggregation(
    available_files: List[Path],
    gdf: gpd.GeoDataFrame,
    years: Optional[List[int]] = None,
    county_col: str = "NAME_1",
    output_path: Optional[Path] = None,
) -> Tuple[pd.DataFrame, Path]:
    """Run the full aggregation pipeline across all years.

    Calls :func:`aggregate_year` for each year, stacks the results,
    computes demographic indicators via :func:`calculate_indicators`,
    appends county areas, and saves to CSV.

    Args:
        available_files: List of locally available TIF files.
        gdf:             County polygon GeoDataFrame in EPSG:4326.
        years:           Years to process (defaults to 2021–2025).
        county_col:      Column in *gdf* containing county names.
        output_path:     CSV destination (defaults to
                         ``data/processed/kenya_population_by_county.csv``).

    Returns:
        Tuple of ``(DataFrame, csv_path)``.
    """
    years = years or SUPPORTED_YEARS
    frames: List[pd.DataFrame] = []

    for year in years:
        try:
            df_year = aggregate_year(year, available_files, gdf, county_col=county_col)
            frames.append(df_year)
        except Exception as exc:
            logger.error("Aggregation failed for year %d: %s — skipping.", year, exc)

    if not frames:
        raise RuntimeError("No years were successfully aggregated.")

    combined = pd.concat(frames, ignore_index=True)
    combined = calculate_indicators(combined)
    combined = add_county_area(combined, gdf, county_col=county_col)

    csv_path = save_to_csv(combined, output_path=output_path)
    return combined, csv_path
