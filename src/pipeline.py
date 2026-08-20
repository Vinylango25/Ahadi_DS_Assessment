"""
pipeline.py — Main orchestration script for the Ahadi Kenya Population Analytics pipeline.

Runs end-to-end:
  1. Download WorldPop Kenya rasters (2021–2025, both sexes, all age groups).
  2. Validate files (completeness, CRS, negative values, zero coverage).
  3. Aggregate population to county level and compute demographic indicators.
  4. Generate static visualisations saved to outputs/figures/.

Usage::

    python pipeline.py [--years 2021 2022 ...] [--force-download]

Run from the project root or the src/ directory.
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import List, Optional

# ---------------------------------------------------------------------------
# Ensure src/ is on the path when running as a script
# ---------------------------------------------------------------------------
_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend — must be set before pyplot import
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
import pandas as pd
import geopandas as gpd
import rasterio
import rasterio.plot

from aggregation import run_aggregation
from data_access import download_all_files, list_available_files
from utils import (
    FIGURES_DIR,
    PROJECT_ROOT,
    PROCESSED_DATA_DIR,
    SUPPORTED_YEARS,
    ensure_directory,
    setup_logging,
)
from validation import run_full_validation

# ---------------------------------------------------------------------------
# Logger
# ---------------------------------------------------------------------------

logger = setup_logging(
    name="ahadi.pipeline",
    level=logging.INFO,
    log_file=PROCESSED_DATA_DIR / "pipeline.log",
)

# ---------------------------------------------------------------------------
# Default paths
# ---------------------------------------------------------------------------

GEOJSON_PATH: Path = PROJECT_ROOT / "data" / "gadm41_KEN_2.json"
COUNTY_NAME_COL: str = "NAME_1"


# ---------------------------------------------------------------------------
# Visualisation helpers
# ---------------------------------------------------------------------------

def plot_raster_map(
    raster_path: Path,
    gdf: gpd.GeoDataFrame,
    output_path: Path,
    title: str = "Population Density",
    cmap: str = "YlOrRd",
) -> None:
    """Render a single raster band overlaid with county boundaries.

    Saves the figure to *output_path* as a PNG at 150 dpi.

    Args:
        raster_path:  Path to the ``.tif`` raster to display.
        gdf:          County boundary GeoDataFrame for overlay.
        output_path:  Destination path for the PNG file.
        title:        Figure title string.
        cmap:         Matplotlib colormap name (default ``"YlOrRd"``).
    """
    logger.info("Generating raster map: %s", output_path.name)
    ensure_directory(output_path.parent)

    try:
        fig, ax = plt.subplots(figsize=(10, 12))

        with rasterio.open(raster_path) as src:
            data = src.read(1, masked=True).astype(float)
            nodata = src.nodata
            if nodata is not None:
                data = np.ma.masked_where(data == nodata, data)
            data = np.ma.masked_where(data < 0, data)
            extent = [
                src.bounds.left, src.bounds.right,
                src.bounds.bottom, src.bounds.top,
            ]

        im = ax.imshow(
            data,
            extent=extent,
            cmap=cmap,
            norm=mcolors.LogNorm(vmin=max(data.min(), 0.1), vmax=data.max()),
            origin="upper",
            interpolation="nearest",
        )
        gdf.boundary.plot(ax=ax, linewidth=0.5, edgecolor="black", facecolor="none")

        plt.colorbar(im, ax=ax, fraction=0.03, pad=0.04, label="Population count")
        ax.set_title(title, fontsize=14, fontweight="bold")
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
        ax.set_aspect("equal")

        fig.tight_layout()
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        logger.info("Saved raster map: %s", output_path)

    except Exception as exc:
        logger.error("Failed to generate raster map '%s': %s", output_path.name, exc)
        plt.close("all")


def plot_timeseries(
    df: pd.DataFrame,
    output_path: Path,
) -> None:
    """Plot total Kenya population for each year as a line chart.

    Args:
        df:          Aggregated county DataFrame with ``year`` and
                     ``total_population`` columns.
        output_path: Destination PNG path.
    """
    logger.info("Generating time-series chart: %s", output_path.name)
    ensure_directory(output_path.parent)

    try:
        ts = (
            df.groupby("year")["total_population"]
            .sum()
            .reset_index()
            .sort_values("year")
        )

        fig, ax = plt.subplots(figsize=(9, 5))
        ax.plot(
            ts["year"], ts["total_population"] / 1e6,
            marker="o", linewidth=2.5, color="#1f77b4", markersize=7,
        )
        ax.fill_between(
            ts["year"], ts["total_population"] / 1e6,
            alpha=0.15, color="#1f77b4",
        )

        ax.set_title("Total Kenya Population (2021–2025)", fontsize=14, fontweight="bold")
        ax.set_xlabel("Year")
        ax.set_ylabel("Population (millions)")
        ax.set_xticks(ts["year"].tolist())
        ax.yaxis.set_major_formatter(
            plt.FuncFormatter(lambda x, _: f"{x:.1f}M")
        )
        ax.grid(axis="y", linestyle="--", alpha=0.5)
        ax.spines[["top", "right"]].set_visible(False)

        fig.tight_layout()
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        logger.info("Saved time-series chart: %s", output_path)

    except Exception as exc:
        logger.error("Failed to generate time-series chart: %s", exc)
        plt.close("all")


def plot_scatter_children_vs_area(
    df: pd.DataFrame,
    output_path: Path,
    year: int = 2025,
) -> None:
    """Scatter plot of children_under_5 vs. county_area_km2 for a given year.

    Each point represents one county, coloured by region (if available) or
    a default palette.

    Args:
        df:          Aggregated county DataFrame with ``children_under_5`` and
                     ``county_area_km2`` columns.
        output_path: Destination PNG path.
        year:        Year to filter (default 2025).
    """
    logger.info("Generating scatter plot: %s", output_path.name)
    ensure_directory(output_path.parent)

    try:
        subset = df[df["year"] == year].copy()
        if subset.empty:
            logger.warning("No data for year %d — scatter plot skipped.", year)
            return

        # Drop rows missing required columns
        required = ["children_under_5", "county_area_km2"]
        subset = subset.dropna(subset=required)

        if subset.empty:
            logger.warning("All rows missing children_under_5 or county_area_km2 — scatter skipped.")
            return

        fig, ax = plt.subplots(figsize=(10, 7))

        scatter = ax.scatter(
            subset["county_area_km2"],
            subset["children_under_5"] / 1e3,
            alpha=0.75,
            edgecolors="white",
            linewidths=0.5,
            s=80,
            c=subset["children_under_5"],
            cmap="plasma",
        )

        # Label the top 5 counties by children_under_5
        top5 = subset.nlargest(5, "children_under_5")
        for _, row in top5.iterrows():
            ax.annotate(
                row["county"],
                xy=(row["county_area_km2"], row["children_under_5"] / 1e3),
                xytext=(5, 5),
                textcoords="offset points",
                fontsize=7,
                color="dimgray",
            )

        plt.colorbar(scatter, ax=ax, label="Children under 5 (absolute)")
        ax.set_title(
            f"Children Under 5 vs County Area — {year}",
            fontsize=14, fontweight="bold",
        )
        ax.set_xlabel("County Area (km²)")
        ax.set_ylabel("Children Under 5 (thousands)")
        ax.grid(linestyle="--", alpha=0.4)
        ax.spines[["top", "right"]].set_visible(False)

        fig.tight_layout()
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        logger.info("Saved scatter plot: %s", output_path)

    except Exception as exc:
        logger.error("Failed to generate scatter plot: %s", exc)
        plt.close("all")


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

def step_download(years: List[int], force: bool) -> List[Path]:
    """Step 1 — Download WorldPop raster files.

    Args:
        years: Years to download.
        force: Re-download even if files are cached.

    Returns:
        List of available local file paths.
    """
    logger.info("STEP 1: Downloading WorldPop rasters for years %s…", years)
    files = download_all_files(years=years, force=force)
    logger.info("STEP 1 complete — %d files available.", len(files))
    return files


def step_validate(available_files: List[Path], geojson_path: Path) -> dict:
    """Step 2 — Validate downloaded files and boundaries.

    Args:
        available_files: List of locally available TIF files.
        geojson_path:    County boundary GeoJSON path.

    Returns:
        Validation report dictionary.
    """
    logger.info("STEP 2: Running validation checks…")
    report = run_full_validation(available_files, geojson_path, sample_size=10)
    passed = report.get("overall_passed", False)
    logger.info("STEP 2 complete — overall validation passed: %s.", passed)
    if not passed:
        logger.warning("Validation issues detected — review validation_log.txt for details.")
    return report


def step_aggregate(
    available_files: List[Path],
    gdf: gpd.GeoDataFrame,
    years: List[int],
) -> pd.DataFrame:
    """Step 3 — Aggregate rasters to county level and compute indicators.

    Args:
        available_files: List of available TIF file paths.
        gdf:             County boundary GeoDataFrame.
        years:           Years to aggregate.

    Returns:
        Aggregated DataFrame with demographic indicators.
    """
    logger.info("STEP 3: Running aggregation for years %s…", years)
    df, csv_path = run_aggregation(available_files, gdf, years=years)
    logger.info("STEP 3 complete — results saved to '%s'.", csv_path)
    return df


def step_visualise(
    df: pd.DataFrame,
    gdf: gpd.GeoDataFrame,
    available_files: List[Path],
) -> None:
    """Step 4 — Generate static visualisations.

    Produces three PNG files in outputs/figures/:
    - ``map_2025_male_0_to_4.png``
    - ``timeseries_total_population.png``
    - ``scatterplot_children_vs_county_size.png``

    Args:
        df:              Aggregated county DataFrame.
        gdf:             County boundary GeoDataFrame.
        available_files: Available TIF files (for raster map selection).
    """
    logger.info("STEP 4: Generating visualisations…")
    ensure_directory(FIGURES_DIR)

    # --- Map: 2025 male age 0–4 (combined age 0 and age 1 male rasters) ---
    from utils import build_worldpop_filename, RAW_DATA_DIR  # local import

    map_output = FIGURES_DIR / "map_2025_male_0_to_4.png"
    raster_m0 = RAW_DATA_DIR / build_worldpop_filename("m", 0, 2025)
    raster_m1 = RAW_DATA_DIR / build_worldpop_filename("m", 1, 2025)

    # Use whichever file is available; prefer age-0 for the map
    for rpath in [raster_m0, raster_m1]:
        if rpath.exists():
            plot_raster_map(
                rpath, gdf, map_output,
                title="Kenya 2025 — Male Population Age 0–4 (per km²)",
            )
            break
    else:
        logger.warning(
            "No 2025 male age-0/1 rasters available — map_2025_male_0_to_4.png skipped."
        )

    # --- Time-series: total population 2021–2025 ---
    ts_output = FIGURES_DIR / "timeseries_total_population.png"
    if "total_population" in df.columns and "year" in df.columns:
        plot_timeseries(df, ts_output)
    else:
        logger.warning("'total_population' column missing — time-series chart skipped.")

    # --- Scatter: children_under_5 vs county_area_km2 ---
    scatter_output = FIGURES_DIR / "scatterplot_children_vs_county_size.png"
    if "children_under_5" in df.columns and "county_area_km2" in df.columns:
        plot_scatter_children_vs_area(df, scatter_output, year=2025)
    else:
        logger.warning("Required columns missing — scatter plot skipped.")

    logger.info("STEP 4 complete.")


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def run_pipeline(
    years: Optional[List[int]] = None,
    force_download: bool = False,
    geojson_path: Optional[Path] = None,
) -> None:
    """Run the full Ahadi Kenya Population Analytics pipeline.

    Args:
        years:          Years to process (defaults to 2021–2025).
        force_download: Re-download files even when they are cached.
        geojson_path:   Path to county boundary GeoJSON. Defaults to
                        ``data/gadm41_KEN_2.json``.
    """
    years = years or SUPPORTED_YEARS
    geojson_path = geojson_path or GEOJSON_PATH

    logger.info("=" * 70)
    logger.info("AHADI KENYA POPULATION ANALYTICS — PIPELINE START")
    logger.info("Years: %s | Force download: %s", years, force_download)
    logger.info("=" * 70)

    # Step 1: Download
    available_files = step_download(years, force=force_download)

    # Step 2: Validate
    step_validate(available_files, geojson_path)

    # Load boundaries (needed for aggregation and visualisation)
    logger.info("Loading county boundaries from '%s'…", geojson_path)
    try:
        from validation import validate_boundaries
        gdf = validate_boundaries(geojson_path)
    except Exception as exc:
        logger.error("Cannot load boundaries: %s — pipeline aborted.", exc)
        sys.exit(1)

    # Step 3: Aggregate
    if not available_files:
        logger.error("No raster files available for aggregation — pipeline aborted.")
        sys.exit(1)

    df = step_aggregate(available_files, gdf, years=years)

    # Step 4: Visualise
    step_visualise(df, gdf, available_files)

    logger.info("=" * 70)
    logger.info("PIPELINE COMPLETE")
    logger.info("=" * 70)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed :class:`argparse.Namespace`.
    """
    parser = argparse.ArgumentParser(
        description="Ahadi Kenya Population Analytics — main pipeline",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=SUPPORTED_YEARS,
        metavar="YEAR",
        help="Years to process (e.g. --years 2021 2022 2025).",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        default=False,
        help="Re-download files even when they are cached.",
    )
    parser.add_argument(
        "--geojson",
        type=Path,
        default=GEOJSON_PATH,
        metavar="PATH",
        help="Path to county boundary GeoJSON file.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run_pipeline(
        years=args.years,
        force_download=args.force_download,
        geojson_path=args.geojson,
    )
