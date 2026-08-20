"""
utils.py — Helper utilities for the Ahadi Kenya Population Analytics pipeline.

Provides:
- Centralised logging configuration
- File-system helpers (directory creation, path resolution)
- WorldPop URL / filename construction for Kenya raster files
"""

import logging
import os
from pathlib import Path
from typing import List, Tuple

# ---------------------------------------------------------------------------
# Project-level constants
# ---------------------------------------------------------------------------

# Root of the project (one level above this file's parent)
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent

RAW_DATA_DIR: Path = PROJECT_ROOT / "data" / "raw"
PROCESSED_DATA_DIR: Path = PROJECT_ROOT / "data" / "processed"
FIGURES_DIR: Path = PROJECT_ROOT / "outputs" / "figures"
VALIDATION_LOG_PATH: Path = PROCESSED_DATA_DIR / "validation_log.txt"

# WorldPop base URL template
WORLDPOP_BASE_URL: str = (
    "https://data.worldpop.org/GIS/AgeSex_structures/"
    "Global_2000_2020_1km_UNadj/unconstrained/{year}/KEN/"
)

# Supported parameter ranges
SUPPORTED_YEARS: List[int] = [2021, 2022, 2023, 2024, 2025]
SUPPORTED_SEXES: List[str] = ["m", "f"]
SUPPORTED_AGES: List[int] = [0, 1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(
    name: str = "ahadi",
    level: int = logging.INFO,
    log_file: Path | None = None,
) -> logging.Logger:
    """Configure and return a named logger.

    Sets up a console handler and, optionally, a file handler.  Calling this
    function multiple times with the same *name* is safe — duplicate handlers
    are not added on subsequent calls.

    Args:
        name:     Logger name (default ``"ahadi"``).
        level:    Logging level (default :data:`logging.INFO`).
        log_file: Optional path to a log file.  The parent directory is
                  created automatically if it does not exist.

    Returns:
        A configured :class:`logging.Logger` instance.
    """
    logger = logging.getLogger(name)

    # Avoid adding duplicate handlers on re-import / re-call
    if logger.handlers:
        return logger

    logger.setLevel(level)

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(level)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # File handler (optional)
    if log_file is not None:
        ensure_directory(log_file.parent)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setLevel(level)
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger


# ---------------------------------------------------------------------------
# File-system helpers
# ---------------------------------------------------------------------------

def ensure_directory(path: Path) -> Path:
    """Create *path* (and any missing parents) if it does not already exist.

    Args:
        path: Directory path to create.

    Returns:
        The same *path* that was passed in (allows chaining).
    """
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_raw_filepath(filename: str) -> Path:
    """Return the absolute path for a raw data file inside ``data/raw/``.

    Args:
        filename: Bare filename, e.g. ``"ken_m_0_2021_1km_UNadj.tif"``.

    Returns:
        :class:`pathlib.Path` pointing to ``data/raw/<filename>``.
    """
    return RAW_DATA_DIR / filename


def get_processed_filepath(filename: str) -> Path:
    """Return the absolute path for a processed file inside ``data/processed/``.

    Args:
        filename: Bare filename, e.g. ``"kenya_population_by_county.csv"``.

    Returns:
        :class:`pathlib.Path` pointing to ``data/processed/<filename>``.
    """
    return PROCESSED_DATA_DIR / filename


# ---------------------------------------------------------------------------
# WorldPop URL / filename helpers
# ---------------------------------------------------------------------------

def build_worldpop_filename(sex: str, age: int, year: int) -> str:
    """Construct the standard WorldPop Kenya raster filename.

    The naming convention used by WorldPop is::

        ken_{sex}_{age}_{year}_1km_UNadj.tif

    Args:
        sex:  Sex code — ``"m"`` (male) or ``"f"`` (female).
        age:  Age-group start in years: 0, 1, 5, 10, 15, …, 80.
        year: Reference year, e.g. 2021.

    Returns:
        Filename string, e.g. ``"ken_m_0_2021_1km_UNadj.tif"``.

    Raises:
        ValueError: If *sex*, *age*, or *year* are not in the supported sets.
    """
    sex = sex.lower()
    if sex not in SUPPORTED_SEXES:
        raise ValueError(f"sex must be one of {SUPPORTED_SEXES}, got '{sex}'")
    if age not in SUPPORTED_AGES:
        raise ValueError(f"age must be one of {SUPPORTED_AGES}, got {age}")
    if year not in SUPPORTED_YEARS:
        raise ValueError(f"year must be one of {SUPPORTED_YEARS}, got {year}")

    return f"ken_{sex}_{age}_{year}_1km_UNadj.tif"


def build_worldpop_url(sex: str, age: int, year: int) -> str:
    """Construct the full WorldPop download URL for a Kenya raster file.

    Combines the base URL template with the filename produced by
    :func:`build_worldpop_filename`.

    Args:
        sex:  Sex code — ``"m"`` or ``"f"``.
        age:  Age-group start in years.
        year: Reference year.

    Returns:
        Fully-qualified HTTPS URL string.

    Raises:
        ValueError: Propagated from :func:`build_worldpop_filename`.
    """
    filename = build_worldpop_filename(sex, age, year)
    base = WORLDPOP_BASE_URL.format(year=year)
    return base + filename


def enumerate_all_combinations() -> List[Tuple[int, str, int]]:
    """Enumerate every (year, sex, age) combination supported by the pipeline.

    Returns:
        Sorted list of ``(year, sex, age)`` tuples covering all years in
        :data:`SUPPORTED_YEARS`, both sexes, and all age groups in
        :data:`SUPPORTED_AGES`.
    """
    combos: List[Tuple[int, str, int]] = []
    for year in SUPPORTED_YEARS:
        for sex in SUPPORTED_SEXES:
            for age in SUPPORTED_AGES:
                combos.append((year, sex, age))
    return combos


def parse_worldpop_filename(filename: str) -> Tuple[str, int, int]:
    """Extract (sex, age, year) metadata from a WorldPop Kenya filename.

    Expected format: ``ken_{sex}_{age}_{year}_1km_UNadj.tif``

    Args:
        filename: Bare filename or full path string.

    Returns:
        Tuple of ``(sex, age, year)`` where *sex* is ``"m"`` or ``"f"``,
        *age* is an integer, and *year* is a 4-digit integer.

    Raises:
        ValueError: If the filename does not match the expected pattern.
    """
    # Normalise: strip directories and extension
    base = Path(filename).stem  # e.g. "ken_m_0_2021_1km_UNadj"
    parts = base.split("_")
    # Expected parts: ['ken', sex, age, year, '1km', 'UNadj']
    if len(parts) != 6 or parts[0] != "ken" or parts[4] != "1km" or parts[5] != "UNadj":
        raise ValueError(
            f"Filename '{filename}' does not match expected pattern "
            "'ken_{{sex}}_{{age}}_{{year}}_1km_UNadj.tif'"
        )

    sex = parts[1]
    try:
        age = int(parts[2])
        year = int(parts[3])
    except ValueError as exc:
        raise ValueError(
            f"Could not parse age/year from filename '{filename}': {exc}"
        ) from exc

    return sex, age, year
