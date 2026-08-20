"""
validation.py — Data quality checks for the Ahadi Kenya Population Analytics pipeline.

Provides functions to:
- Parse WorldPop filenames to extract metadata.
- Verify that all expected age-sex-year combinations are present.
- Validate raster CRS, negative values, and suspicious zero coverage.
- Load and validate county boundary GeoJSON files.
- Write a structured validation log to data/processed/validation_log.txt.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.crs import CRS

from utils import (
    PROCESSED_DATA_DIR,
    SUPPORTED_AGES,
    SUPPORTED_SEXES,
    SUPPORTED_YEARS,
    VALIDATION_LOG_PATH,
    ensure_directory,
    parse_worldpop_filename,
    setup_logging,
)

# ---------------------------------------------------------------------------
# Module logger (also writes to validation_log.txt via _val_logger)
# ---------------------------------------------------------------------------

logger = setup_logging("ahadi.validation")

# A dedicated file-only logger that writes every validation event to
# the structured log file expected by downstream consumers.
_val_logger: Optional[logging.Logger] = None


def _get_validation_logger() -> logging.Logger:
    """Return (or lazily create) the file-based validation logger.

    Returns:
        :class:`logging.Logger` instance writing to
        ``data/processed/validation_log.txt``.
    """
    global _val_logger
    if _val_logger is not None:
        return _val_logger

    ensure_directory(PROCESSED_DATA_DIR)
    _val_logger = logging.getLogger("ahadi.validation.file")
    _val_logger.setLevel(logging.DEBUG)

    if not _val_logger.handlers:
        fh = logging.FileHandler(VALIDATION_LOG_PATH, mode="a", encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        fh.setFormatter(fmt)
        _val_logger.addHandler(fh)

    return _val_logger


def _vlog(level: int, message: str, *args) -> None:
    """Write *message* to both the module logger and the validation file log.

    Args:
        level:   :mod:`logging` level constant (e.g. ``logging.INFO``).
        message: Log message (may contain ``%``-style format tokens).
        *args:   Format arguments for *message*.
    """
    logger.log(level, message, *args)
    _get_validation_logger().log(level, message, *args)


# ---------------------------------------------------------------------------
# Filename parsing
# ---------------------------------------------------------------------------

def parse_filename(filename: str) -> Tuple[str, int, int]:
    """Extract ``(sex, age, year)`` from a WorldPop Kenya TIF filename.

    Delegates to :func:`utils.parse_worldpop_filename` and logs the result.

    Args:
        filename: Bare filename or full path string, e.g.
                  ``"ken_f_15_2023_1km_UNadj.tif"``.

    Returns:
        Tuple of ``(sex, age, year)``.

    Raises:
        ValueError: If the filename does not match the expected pattern.
    """
    try:
        sex, age, year = parse_worldpop_filename(filename)
        _vlog(logging.DEBUG, "Parsed '%s' → sex=%s, age=%d, year=%d", filename, sex, age, year)
        return sex, age, year
    except ValueError as exc:
        _vlog(logging.ERROR, "Could not parse filename '%s': %s", filename, exc)
        raise


# ---------------------------------------------------------------------------
# Completeness check
# ---------------------------------------------------------------------------

def check_completeness(
    available_files: List[Path],
    years: Optional[List[int]] = None,
    sexes: Optional[List[str]] = None,
    ages: Optional[List[int]] = None,
) -> Dict[str, List[str]]:
    """Verify that all expected age-sex-year combinations are present.

    Logs each missing file together with a recommended action:
    - **drop** — if the missing combination is optional (e.g. the entire
      year is absent).
    - **impute** — if most combinations for that year exist and only a few
      are missing (missing < 20 % of combinations for that year).

    Args:
        available_files: List of paths to locally-available TIF files.
        years:  Expected years (defaults to :data:`~utils.SUPPORTED_YEARS`).
        sexes:  Expected sex codes (defaults to both).
        ages:   Expected age groups (defaults to all supported ages).

    Returns:
        Dictionary with keys ``"present"`` and ``"missing"``, each mapping
        to a list of filename strings.
    """
    years = years or SUPPORTED_YEARS
    sexes = sexes or SUPPORTED_SEXES
    ages = ages or SUPPORTED_AGES

    # Build set of expected filenames
    from utils import build_worldpop_filename  # avoid circular at module level

    expected: Set[str] = set()
    for year in years:
        for sex in sexes:
            for age in ages:
                expected.add(build_worldpop_filename(sex, age, year))

    # Build set of available basenames
    present_names: Set[str] = set()
    for p in available_files:
        try:
            parse_worldpop_filename(p.name)
            present_names.add(p.name)
        except ValueError:
            _vlog(logging.WARNING, "Ignoring unrecognised file: %s", p.name)

    missing_names = expected - present_names
    present_list = sorted(present_names & expected)
    missing_list = sorted(missing_names)

    _vlog(logging.INFO, "Completeness check: %d expected, %d present, %d missing.",
          len(expected), len(present_list), len(missing_list))

    # Per-year triage
    combos_per_year = len(sexes) * len(ages)
    for year in years:
        missing_this_year = [f for f in missing_list if f"_{year}_" in f]
        if not missing_this_year:
            _vlog(logging.INFO, "Year %d: all combinations present.", year)
            continue

        pct_missing = len(missing_this_year) / combos_per_year * 100
        if pct_missing >= 100:
            decision = "drop"
        elif pct_missing < 20:
            decision = "impute"
        else:
            decision = "drop"

        _vlog(
            logging.WARNING,
            "Year %d: %d/%d combinations missing (%.0f%%) → decision: %s.",
            year, len(missing_this_year), combos_per_year, pct_missing, decision,
        )
        for fname in missing_this_year:
            _vlog(logging.WARNING, "  MISSING [%s]: %s", decision.upper(), fname)

    return {"present": present_list, "missing": missing_list}


# ---------------------------------------------------------------------------
# Boundary (GeoJSON) validation
# ---------------------------------------------------------------------------

def validate_boundaries(geojson_path: Path) -> gpd.GeoDataFrame:
    """Load county boundary GeoJSON and verify it uses EPSG:4326.

    Args:
        geojson_path: Path to the GeoJSON boundary file.

    Returns:
        Validated :class:`geopandas.GeoDataFrame` with CRS guaranteed to
        be EPSG:4326.

    Raises:
        FileNotFoundError: If *geojson_path* does not exist.
        ValueError:        If the CRS cannot be reconciled with EPSG:4326.
    """
    _vlog(logging.INFO, "Loading boundary file: %s", geojson_path)

    if not geojson_path.exists():
        _vlog(logging.ERROR, "Boundary file not found: %s", geojson_path)
        raise FileNotFoundError(f"Boundary file not found: {geojson_path}")

    try:
        gdf = gpd.read_file(geojson_path)
    except Exception as exc:
        _vlog(logging.ERROR, "Failed to read boundary file '%s': %s", geojson_path, exc)
        raise

    _vlog(logging.INFO, "Boundary file loaded: %d features.", len(gdf))

    target_crs = CRS.from_epsg(4326)

    if gdf.crs is None:
        _vlog(logging.WARNING, "Boundary CRS is undefined — assuming EPSG:4326.")
        gdf = gdf.set_crs(target_crs)
    elif not gdf.crs.equals(target_crs):
        _vlog(
            logging.WARNING,
            "Boundary CRS is %s, not EPSG:4326 — reprojecting.",
            gdf.crs.to_string(),
        )
        gdf = gdf.to_crs(target_crs)
        _vlog(logging.INFO, "Reprojected boundary to EPSG:4326.")
    else:
        _vlog(logging.INFO, "Boundary CRS confirmed: EPSG:4326. ✓")

    return gdf


# ---------------------------------------------------------------------------
# Raster CRS validation
# ---------------------------------------------------------------------------

def validate_raster_crs(raster_path: Path) -> bool:
    """Open a raster file and verify that its CRS is EPSG:4326.

    Only reads metadata (no pixel data is loaded).

    Args:
        raster_path: Path to a ``.tif`` raster file.

    Returns:
        ``True`` if the raster CRS matches EPSG:4326, ``False`` otherwise.

    Raises:
        FileNotFoundError: If *raster_path* does not exist.
    """
    if not raster_path.exists():
        _vlog(logging.ERROR, "Raster not found: %s", raster_path)
        raise FileNotFoundError(f"Raster not found: {raster_path}")

    try:
        with rasterio.open(raster_path) as src:
            raster_crs = src.crs
    except rasterio.errors.RasterioIOError as exc:
        _vlog(logging.ERROR, "Could not open raster '%s': %s", raster_path, exc)
        return False

    target_crs = CRS.from_epsg(4326)

    if raster_crs is None:
        _vlog(logging.WARNING, "Raster '%s' has no CRS defined.", raster_path.name)
        return False

    if raster_crs == target_crs or raster_crs.to_epsg() == 4326:
        _vlog(logging.INFO, "Raster CRS OK for '%s': EPSG:4326. ✓", raster_path.name)
        return True

    _vlog(
        logging.WARNING,
        "Raster '%s' CRS is %s, expected EPSG:4326.",
        raster_path.name,
        raster_crs.to_string(),
    )
    return False


# ---------------------------------------------------------------------------
# Raster value checks
# ---------------------------------------------------------------------------

def check_negative_values(raster_path: Path, nodata_threshold: float = -9999.0) -> bool:
    """Scan a raster band for negative population values.

    Values at or below *nodata_threshold* are treated as no-data and
    excluded from the check.

    Args:
        raster_path:      Path to the raster TIF.
        nodata_threshold: Values ≤ this are considered no-data fill values.

    Returns:
        ``True`` if no invalid negatives were found (clean), ``False`` if
        negative values were detected.
    """
    _vlog(logging.INFO, "Checking for negative values in '%s'.", raster_path.name)

    try:
        with rasterio.open(raster_path) as src:
            data = src.read(1, masked=True)
    except Exception as exc:
        _vlog(logging.ERROR, "Could not read raster '%s': %s", raster_path, exc)
        return False

    # Exclude fill / no-data
    valid = data.compressed()  # removes masked values
    valid = valid[valid > nodata_threshold]

    neg_count = int(np.sum(valid < 0))
    if neg_count > 0:
        _vlog(
            logging.WARNING,
            "'%s': found %d negative pixel(s) — possible data artefact.",
            raster_path.name, neg_count,
        )
        return False

    _vlog(logging.INFO, "'%s': no negative values found. ✓", raster_path.name)
    return True


def check_zero_coverage(
    raster_path: Path,
    zero_fraction_threshold: float = 0.95,
    nodata_threshold: float = -9999.0,
) -> bool:
    """Check whether a raster has an unusually high proportion of zero values.

    A raster where more than *zero_fraction_threshold* of valid pixels are
    zero is flagged as suspicious (possible empty or corrupt file).

    Args:
        raster_path:             Path to the raster TIF.
        zero_fraction_threshold: Flag if zero fraction exceeds this (0–1).
        nodata_threshold:        Values ≤ this are treated as no-data.

    Returns:
        ``True`` if zero coverage is within acceptable limits, ``False``
        if the raster is suspiciously sparse.
    """
    _vlog(logging.INFO, "Checking zero coverage in '%s'.", raster_path.name)

    try:
        with rasterio.open(raster_path) as src:
            data = src.read(1, masked=True)
    except Exception as exc:
        _vlog(logging.ERROR, "Could not read raster '%s': %s", raster_path, exc)
        return False

    valid = data.compressed()
    valid = valid[valid > nodata_threshold]

    if valid.size == 0:
        _vlog(logging.WARNING, "'%s': no valid pixels found at all.", raster_path.name)
        return False

    zero_fraction = float(np.sum(valid == 0)) / valid.size
    if zero_fraction > zero_fraction_threshold:
        _vlog(
            logging.WARNING,
            "'%s': %.1f%% of valid pixels are zero (threshold %.0f%%) — suspicious.",
            raster_path.name, zero_fraction * 100, zero_fraction_threshold * 100,
        )
        return False

    _vlog(
        logging.INFO,
        "'%s': zero-coverage check passed (%.1f%% zeros). ✓",
        raster_path.name, zero_fraction * 100,
    )
    return True


# ---------------------------------------------------------------------------
# Full validation run
# ---------------------------------------------------------------------------

def run_full_validation(
    available_files: List[Path],
    geojson_path: Path,
    sample_size: int = 5,
) -> Dict:
    """Run all validation checks and return a summary report.

    Checks performed:
    1. Completeness — are all expected files present?
    2. Boundary CRS — is the GeoJSON in EPSG:4326?
    3. Raster CRS — sample of rasters checked for correct CRS.
    4. Negative values — sample of rasters scanned for negative pixels.
    5. Zero coverage — sample of rasters checked for suspicious sparseness.

    Args:
        available_files: List of locally-available TIF paths.
        geojson_path:    Path to the county boundary GeoJSON.
        sample_size:     Number of rasters to sample for value checks.

    Returns:
        Dictionary with keys matching each check and boolean pass/fail values.
    """
    _vlog(logging.INFO, "=" * 60)
    _vlog(logging.INFO, "STARTING FULL VALIDATION RUN")
    _vlog(logging.INFO, "=" * 60)

    report: Dict = {}

    # 1. Completeness
    completeness = check_completeness(available_files)
    report["completeness"] = {
        "n_present": len(completeness["present"]),
        "n_missing": len(completeness["missing"]),
        "missing_files": completeness["missing"],
        "passed": len(completeness["missing"]) == 0,
    }

    # 2. Boundary validation
    try:
        validate_boundaries(geojson_path)
        report["boundary_crs"] = {"passed": True}
    except Exception as exc:
        _vlog(logging.ERROR, "Boundary validation failed: %s", exc)
        report["boundary_crs"] = {"passed": False, "error": str(exc)}

    # 3–5. Per-raster checks (sample)
    sample = available_files[:sample_size] if available_files else []
    crs_results, neg_results, zero_results = [], [], []

    for f in sample:
        crs_results.append(validate_raster_crs(f))
        neg_results.append(check_negative_values(f))
        zero_results.append(check_zero_coverage(f))

    report["raster_crs"] = {"passed": all(crs_results), "results": crs_results}
    report["negative_values"] = {"passed": all(neg_results), "results": neg_results}
    report["zero_coverage"] = {"passed": all(zero_results), "results": zero_results}

    overall = all(v.get("passed", False) for v in report.values())
    report["overall_passed"] = overall

    _vlog(logging.INFO, "VALIDATION COMPLETE — overall passed: %s", overall)
    _vlog(logging.INFO, "=" * 60)

    return report
