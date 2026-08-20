"""
data_access.py — WorldPop raster download and caching for the Ahadi pipeline.

Downloads WorldPop Kenya age-sex rasters from the Global_2015_2030 R2025A
dataset (covers 2021-2025). Each year is packaged as a single zip archive
(~86 MB) containing all age-sex band TIFs; this module handles downloading,
caching, and extracting the individual files.

URL pattern:
    https://data.worldpop.org/GIS/AgeSex_structures/
    Global_2015_2030/R2025A/{year}/KEN/v1/1km_ua/
    ken_agesex_structures_{year}_CN_1km_R2025A_UA_v1.zip
"""

import logging
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

from utils import (
    RAW_DATA_DIR,
    SUPPORTED_AGES,
    SUPPORTED_SEXES,
    SUPPORTED_YEARS,
    build_worldpop_filename,
    build_worldpop_zip_url,
    build_worldpop_zip_filename,
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

DOWNLOAD_CHUNK_SIZE: int = 8 * 1024 * 1024   # 8 MB chunks
RETRY_BACKOFF_SECONDS: int = 10
MAX_RETRIES: int = 3
REQUEST_TIMEOUT: Tuple[int, int] = (30, 300)  # larger read timeout for ~86 MB zips


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def is_zip_cached(year: int, raw_dir: Path = RAW_DATA_DIR) -> bool:
    """Return True if the yearly zip has already been downloaded."""
    zip_path = raw_dir / build_worldpop_zip_filename(year)
    return zip_path.exists() and zip_path.stat().st_size > 0


def is_tif_cached(sex: str, age: int, year: int, raw_dir: Path = RAW_DATA_DIR) -> bool:
    """Return True if the extracted TIF is already on disk."""
    tif_path = raw_dir / build_worldpop_filename(sex, age, year)
    return tif_path.exists() and tif_path.stat().st_size > 0


def is_cached(filename: str, raw_dir: Path = RAW_DATA_DIR) -> bool:
    """Backward-compatible cache check by bare filename."""
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
    """Stream-download *url* to *dest_path* with retry and .part safety.

    Args:
        url:       Full HTTPS URL to download.
        dest_path: Local destination path.
        retries:   Number of retry attempts on transient errors.
        backoff:   Seconds between retries.

    Returns:
        True on success, False if all attempts failed.
    """
    part_path = dest_path.with_suffix(dest_path.suffix + ".part")
    ensure_directory(dest_path.parent)

    for attempt in range(1, retries + 1):
        try:
            logger.info("Downloading (attempt %d/%d): %s", attempt, retries, url)
            with requests.get(url, stream=True, timeout=REQUEST_TIMEOUT) as response:
                response.raise_for_status()
                downloaded = 0
                with open(part_path, "wb") as fh:
                    for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                        if chunk:
                            fh.write(chunk)
                            downloaded += len(chunk)
            part_path.rename(dest_path)
            logger.info("Saved %s (%.1f MB).", dest_path.name, downloaded / (1024 ** 2))
            return True

        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            if status == 404:
                logger.warning("Not found (404): %s — skipping.", url)
                return False
            logger.error("HTTP %s for %s: %s", status, url, exc)

        except (requests.exceptions.ConnectionError,
                requests.exceptions.Timeout) as exc:
            logger.error("Network error for %s: %s", url, exc)

        except OSError as exc:
            logger.error("IO error writing %s: %s", dest_path, exc)
            return False

        if part_path.exists():
            part_path.unlink(missing_ok=True)

        if attempt < retries:
            logger.info("Retrying in %d seconds…", backoff)
            time.sleep(backoff)

    logger.error("All %d download attempts failed for: %s", retries, url)
    return False


# ---------------------------------------------------------------------------
# Zip extraction
# ---------------------------------------------------------------------------

def extract_tifs_from_zip(zip_path: Path, dest_dir: Path) -> List[Path]:
    """Extract all TIF files from a WorldPop year zip into *dest_dir*.

    Args:
        zip_path: Path to the downloaded zip archive.
        dest_dir: Directory to place extracted TIFs.

    Returns:
        List of extracted TIF paths.
    """
    ensure_directory(dest_dir)
    extracted: List[Path] = []
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            members = [m for m in zf.namelist() if m.lower().endswith(".tif")]
            logger.info("Extracting %d TIF(s) from %s", len(members), zip_path.name)
            for member in members:
                filename = Path(member).name
                target = dest_dir / filename
                if target.exists() and target.stat().st_size > 0:
                    logger.debug("Already extracted: %s", filename)
                    extracted.append(target)
                    continue
                with zf.open(member) as src, open(target, "wb") as dst:
                    dst.write(src.read())
                extracted.append(target)
                logger.debug("Extracted: %s (%.1f MB)", filename,
                             target.stat().st_size / (1024 ** 2))
    except zipfile.BadZipFile as exc:
        logger.error("Bad zip file %s: %s", zip_path, exc)
    return extracted


# ---------------------------------------------------------------------------
# Batch download + extract
# ---------------------------------------------------------------------------

def download_all_files(
    years: Optional[List[int]] = None,
    sexes: Optional[List[str]] = None,
    ages: Optional[List[int]] = None,
    raw_dir: Path = RAW_DATA_DIR,
    force: bool = False,
) -> List[Path]:
    """Download WorldPop Kenya yearly zips and extract individual TIFs.

    The R2025A dataset packages all age-sex bands per year in one ~86 MB zip.
    Downloads each year's zip (with caching), extracts all TIFs, then returns
    paths of TIFs matching the requested sex/age parameters.

    Args:
        years:   Years to process. Defaults to SUPPORTED_YEARS (2021-2025).
        sexes:   Sex codes to include. Defaults to both.
        ages:    Age groups to include. Defaults to all supported ages.
        raw_dir: Local cache directory. Defaults to data/raw/.
        force:   Re-download zips even if already cached.

    Returns:
        List of TIF Path objects available after download.
    """
    years = years or SUPPORTED_YEARS
    sexes = sexes or SUPPORTED_SEXES
    ages = ages or SUPPORTED_AGES
    ensure_directory(raw_dir)

    available: List[Path] = []

    for year in years:
        zip_filename = build_worldpop_zip_filename(year)
        zip_path = raw_dir / zip_filename
        zip_url = build_worldpop_zip_url(year)

        # Download zip if not cached
        if force or not is_zip_cached(year, raw_dir):
            logger.info("[Year %d] Downloading: %s", year, zip_url)
            success = download_file(zip_url, zip_path)
            if not success:
                logger.error("Failed to download zip for year %d — skipping.", year)
                continue
        else:
            logger.info("[Year %d] Cache hit: %s", year, zip_filename)

        # Extract TIFs from zip
        extracted = extract_tifs_from_zip(zip_path, raw_dir)
        if not extracted:
            logger.warning("No TIFs extracted from %s", zip_filename)
            continue
        logger.info("[Year %d] %d TIFs extracted.", year, len(extracted))

        # Filter to requested sex/age combinations
        for sex in sexes:
            for age in ages:
                tif_name = build_worldpop_filename(sex, age, year)
                tif_path = raw_dir / tif_name
                if tif_path.exists() and tif_path.stat().st_size > 0:
                    available.append(tif_path)
                else:
                    logger.warning("Expected TIF not found after extraction: %s", tif_name)

    logger.info("Download run complete. Available: %d | Skipped (cached): %d | Failed: %d",
                len(available), 0, 0)
    return available


def build_all_urls(
    years: Optional[List[int]] = None,
    sexes: Optional[List[str]] = None,
    ages: Optional[List[int]] = None,
) -> Dict[str, str]:
    """Build zip filename → URL mapping for each requested year.

    Args:
        years: Years to include. Defaults to SUPPORTED_YEARS.
        sexes: Unused (API compatibility).
        ages:  Unused (API compatibility).

    Returns:
        Dict mapping zip filename → download URL.
    """
    years = years or SUPPORTED_YEARS
    url_map: Dict[str, str] = {}
    for year in years:
        filename = build_worldpop_zip_filename(year)
        url_map[filename] = build_worldpop_zip_url(year)
    logger.info("Built %d WorldPop URLs.", len(url_map))
    return url_map


# ---------------------------------------------------------------------------
# Convenience: list locally available TIF files
# ---------------------------------------------------------------------------

def list_available_files(raw_dir: Path = RAW_DATA_DIR) -> List[Path]:
    """Return all WorldPop Kenya male/female TIFs in the raw data directory.

    Returns only 'm' and 'f' sex-band TIFs (not the 't' total band) so the
    aggregation layer doesn't double-count. Supports both old (UNadj) and new
    (R2025A) naming conventions.
    """
    if not raw_dir.exists():
        logger.warning("Raw data directory does not exist: %s", raw_dir)
        return []
    files = sorted(
        list(raw_dir.glob("ken_[mf]_*_*_1km_UNadj.tif")) +
        list(raw_dir.glob("ken_[mf]_*_*_CN_1km_R2025A_UA_v1.tif"))
    )
    logger.info("Found %d TIF files in %s.", len(files), raw_dir)
    return files
