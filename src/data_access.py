"""
data_access.py — WorldPop raster download and caching for the Ahadi pipeline.

Provides functions to:
- Enumerate all (year, sex, age) WorldPop Kenya URLs for 2021-2025.
- Download TIF files with HTTP error handling and resume-safe caching.
- Return lists of local file paths for downstream processing.
"""

import logging
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

from utils import (
    RAW_DATA_DIR,
    SUPPORTED_AGES,
    SUPPORTED_SEXES,
    SUPPORTED_YEARS,
    build_worldpop_filename,
    build_worldpop_url,
    ensure_directory,
    enumerate_all_combinations,
    setup_logging,
)

# ---------------------------------------------------------------------------
# Module logger
# ---------------------------------------------------------------------------

logger = setup_logging("ahadi.data_access")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Chunk size for streaming downloads (8 MB)
DOWNLOAD_CHUNK_SIZE: int = 8 * 1024 * 1024

# Seconds to wait between retry attempts
RETRY_BACKOFF_SECONDS: int = 5

# Maximum download retry attempts per file
MAX_RETRIES: int = 3

# HTTP request timeout (connect, read) in seconds
REQUEST_TIMEOUT: Tuple[int, int] = (30, 120)


# ---------------------------------------------------------------------------
# URL construction
# ---------------------------------------------------------------------------

def build_all_urls(
    years: Optional[List[int]] = None,
    sexes: Optional[List[str]] = None,
    ages: Optional[List[int]] = None,
) -> Dict[str, str]:
    """Build a mapping of filename → URL for every requested combination.

    Args:
        years: Years to include. Defaults to :data:`~utils.SUPPORTED_YEARS`
               (2021–2025).
        sexes: Sex codes to include (``"m"``, ``"f"``). Defaults to both.
        ages:  Age-group starts to include. Defaults to all supported ages.

    Returns:
        Dictionary mapping each bare filename (e.g.
        ``"ken_m_0_2021_1km_UNadj.tif"``) to its full download URL.
    """
    years = years or SUPPORTED_YEARS
    sexes = sexes or SUPPORTED_SEXES
    ages = ages or SUPPORTED_AGES

    url_map: Dict[str, str] = {}
    for year in years:
        for sex in sexes:
            for age in ages:
                try:
                    filename = build_worldpop_filename(sex, age, year)
                    url = build_worldpop_url(sex, age, year)
                    url_map[filename] = url
                except ValueError as exc:
                    logger.warning("Skipping invalid combination (%s, %s, %s): %s", year, sex, age, exc)
    logger.info("Built %d WorldPop URLs.", len(url_map))
    return url_map


# ---------------------------------------------------------------------------
# Cache check
# ---------------------------------------------------------------------------

def is_cached(filename: str, raw_dir: Path = RAW_DATA_DIR) -> bool:
    """Check whether a file has already been downloaded.

    A file is considered cached only when it exists **and** has a non-zero
    size (a zero-byte file indicates an interrupted download).

    Args:
        filename: Bare filename, e.g. ``"ken_m_0_2021_1km_UNadj.tif"``.
        raw_dir:  Directory to check (defaults to ``data/raw/``).

    Returns:
        ``True`` if a valid cached copy exists, ``False`` otherwise.
    """
    filepath = raw_dir / filename
    return filepath.exists() and filepath.stat().st_size > 0


# ---------------------------------------------------------------------------
# Single-file download
# ---------------------------------------------------------------------------

def download_file(
    url: str,
    dest_path: Path,
    retries: int = MAX_RETRIES,
    backoff: int = RETRY_BACKOFF_SECONDS,
) -> bool:
    """Stream-download a single file from *url* to *dest_path*.

    Uses a temporary ``.part`` file during transfer and renames it on
    success, so interrupted downloads never leave a corrupt file in place.

    Args:
        url:       Full HTTPS URL to the resource.
        dest_path: Local destination path (including filename).
        retries:   Number of retry attempts on transient errors.
        backoff:   Seconds to wait between retries.

    Returns:
        ``True`` on success, ``False`` if all retry attempts failed.
    """
    part_path = dest_path.with_suffix(dest_path.suffix + ".part")
    ensure_directory(dest_path.parent)

    for attempt in range(1, retries + 1):
        try:
            logger.info(
                "Downloading (attempt %d/%d): %s", attempt, retries, url
            )
            with requests.get(url, stream=True, timeout=REQUEST_TIMEOUT) as response:
                response.raise_for_status()

                total = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(part_path, "wb") as fh:
                    for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                        if chunk:
                            fh.write(chunk)
                            downloaded += len(chunk)

            # Rename the .part file to the final name on success
            part_path.rename(dest_path)
            logger.info(
                "Saved %s (%.1f MB).", dest_path.name, downloaded / (1024 ** 2)
            )
            return True

        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            if status == 404:
                logger.warning("File not found (404): %s — skipping.", url)
                return False
            logger.error("HTTP error %s for %s: %s", status, url, exc)

        except requests.exceptions.ConnectionError as exc:
            logger.error("Connection error for %s: %s", url, exc)

        except requests.exceptions.Timeout as exc:
            logger.error("Timeout for %s: %s", url, exc)

        except OSError as exc:
            logger.error("IO error writing %s: %s", dest_path, exc)
            return False

        # Clean up partial file before retry
        if part_path.exists():
            try:
                part_path.unlink()
            except OSError:
                pass

        if attempt < retries:
            logger.info("Retrying in %d seconds…", backoff)
            time.sleep(backoff)

    logger.error("All %d download attempts failed for: %s", retries, url)
    return False


# ---------------------------------------------------------------------------
# Batch download
# ---------------------------------------------------------------------------

def download_all_files(
    years: Optional[List[int]] = None,
    sexes: Optional[List[str]] = None,
    ages: Optional[List[int]] = None,
    raw_dir: Path = RAW_DATA_DIR,
    force: bool = False,
) -> List[Path]:
    """Download all WorldPop Kenya raster files for the requested parameters.

    Skips files that are already present in the cache (unless *force* is
    ``True``).  Returns the paths of every successfully available file
    (both freshly downloaded and pre-cached).

    Args:
        years:   Years to download. Defaults to 2021–2025.
        sexes:   Sex codes to download. Defaults to both.
        ages:    Age groups to download. Defaults to all supported ages.
        raw_dir: Local cache directory. Defaults to ``data/raw/``.
        force:   When ``True``, re-download even if the file is cached.

    Returns:
        List of :class:`pathlib.Path` objects for every file that is
        available locally after the download run.
    """
    ensure_directory(raw_dir)
    url_map = build_all_urls(years=years, sexes=sexes, ages=ages)

    available: List[Path] = []
    skipped = 0
    failed = 0

    total = len(url_map)
    for idx, (filename, url) in enumerate(url_map.items(), start=1):
        dest_path = raw_dir / filename
        logger.info("[%d/%d] %s", idx, total, filename)

        if not force and is_cached(filename, raw_dir):
            logger.debug("Cache hit: %s — skipping download.", filename)
            available.append(dest_path)
            skipped += 1
            continue

        success = download_file(url, dest_path)
        if success:
            available.append(dest_path)
        else:
            failed += 1

    logger.info(
        "Download run complete. Available: %d | Skipped (cached): %d | Failed: %d",
        len(available),
        skipped,
        failed,
    )
    return available


# ---------------------------------------------------------------------------
# Convenience: list locally available files
# ---------------------------------------------------------------------------

def list_available_files(raw_dir: Path = RAW_DATA_DIR) -> List[Path]:
    """Return all ``.tif`` files currently present in the raw data directory.

    Args:
        raw_dir: Directory to scan (defaults to ``data/raw/``).

    Returns:
        Sorted list of :class:`pathlib.Path` objects for every TIF file found.
    """
    if not raw_dir.exists():
        logger.warning("Raw data directory does not exist: %s", raw_dir)
        return []
    files = sorted(raw_dir.glob("ken_*_*_*_1km_UNadj.tif"))
    logger.info("Found %d TIF files in %s.", len(files), raw_dir)
    return files
