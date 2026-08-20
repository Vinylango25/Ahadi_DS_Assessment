"""
test_validation.py — Unit tests for src/validation.py.

Tests cover:
- Filename parsing (happy path, edge cases, invalid inputs).
- Missing-file detection via check_completeness().
- Negative value handling via check_negative_values().

Run with::

    python -m pytest tests/test_validation.py -v
    # or
    python -m unittest tests/test_validation.py
"""

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Ensure src/ is importable
# ---------------------------------------------------------------------------
_SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from validation import check_completeness, check_negative_values, parse_filename


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_tif(path: Path, data: np.ndarray, nodata: float = -9999.0) -> None:
    """Write a small single-band GeoTIFF for testing purposes.

    Args:
        path:   Destination file path.
        data:   2-D NumPy array of pixel values.
        nodata: No-data fill value to encode in the TIFF metadata.
    """
    import rasterio
    from rasterio.transform import from_bounds

    transform = from_bounds(36.0, -5.0, 42.0, 5.0, data.shape[1], data.shape[0])
    with rasterio.open(
        path,
        mode="w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype=data.dtype,
        crs="EPSG:4326",
        transform=transform,
        nodata=nodata,
    ) as dst:
        dst.write(data, 1)


# ===========================================================================
# Test: parse_filename
# ===========================================================================

class TestParseFilename(unittest.TestCase):
    """Tests for :func:`validation.parse_filename`."""

    def test_valid_male_age0_2021(self):
        """Standard male age-0 filename for 2021 parses correctly."""
        sex, age, year = parse_filename("ken_m_0_2021_1km_UNadj.tif")
        self.assertEqual(sex, "m")
        self.assertEqual(age, 0)
        self.assertEqual(year, 2021)

    def test_valid_female_age80_2025(self):
        """Standard female age-80 filename for 2025 parses correctly."""
        sex, age, year = parse_filename("ken_f_80_2025_1km_UNadj.tif")
        self.assertEqual(sex, "f")
        self.assertEqual(age, 80)
        self.assertEqual(year, 2025)

    def test_valid_male_age15_2023(self):
        """Male age-15 filename for 2023 parses correctly."""
        sex, age, year = parse_filename("ken_m_15_2023_1km_UNadj.tif")
        self.assertEqual(sex, "m")
        self.assertEqual(age, 15)
        self.assertEqual(year, 2023)

    def test_full_path_is_accepted(self):
        """Full path strings are accepted; only the basename is parsed."""
        sex, age, year = parse_filename("/data/raw/ken_f_5_2022_1km_UNadj.tif")
        self.assertEqual(sex, "f")
        self.assertEqual(age, 5)
        self.assertEqual(year, 2022)

    def test_windows_path_is_accepted(self):
        """Windows-style path strings are also correctly handled."""
        sex, age, year = parse_filename(r"C:\data\ken_m_70_2024_1km_UNadj.tif")
        self.assertEqual(sex, "m")
        self.assertEqual(age, 70)
        self.assertEqual(year, 2024)

    def test_invalid_prefix_raises(self):
        """Filenames with wrong prefix raise ValueError."""
        with self.assertRaises(ValueError):
            parse_filename("uga_m_0_2021_1km_UNadj.tif")

    def test_invalid_suffix_raises(self):
        """Filenames with wrong suffix raise ValueError."""
        with self.assertRaises(ValueError):
            parse_filename("ken_m_0_2021_2km_UNadj.tif")

    def test_non_numeric_age_raises(self):
        """Filenames with non-numeric age segment raise ValueError."""
        with self.assertRaises(ValueError):
            parse_filename("ken_m_young_2021_1km_UNadj.tif")

    def test_non_numeric_year_raises(self):
        """Filenames with non-numeric year segment raise ValueError."""
        with self.assertRaises(ValueError):
            parse_filename("ken_m_0_YYYY_1km_UNadj.tif")

    def test_empty_string_raises(self):
        """Empty string raises ValueError."""
        with self.assertRaises(ValueError):
            parse_filename("")

    def test_all_supported_ages_parse(self):
        """All supported age groups parse without error for both sexes."""
        from utils import SUPPORTED_AGES, SUPPORTED_SEXES

        for sex in SUPPORTED_SEXES:
            for age in SUPPORTED_AGES:
                fname = f"ken_{sex}_{age}_2021_1km_UNadj.tif"
                parsed_sex, parsed_age, parsed_year = parse_filename(fname)
                self.assertEqual(parsed_sex, sex, msg=f"Sex mismatch for {fname}")
                self.assertEqual(parsed_age, age, msg=f"Age mismatch for {fname}")
                self.assertEqual(parsed_year, 2021, msg=f"Year mismatch for {fname}")


# ===========================================================================
# Test: check_completeness (missing file detection)
# ===========================================================================

class TestCheckCompleteness(unittest.TestCase):
    """Tests for :func:`validation.check_completeness`."""

    def _make_paths(self, filenames):
        """Convert a list of filenames into mock Path objects."""
        return [Path(f"/mock/raw/{fn}") for fn in filenames]

    def test_empty_available_all_missing(self):
        """When no files are provided, all expected files are listed as missing."""
        result = check_completeness(
            available_files=[],
            years=[2021],
            sexes=["m"],
            ages=[0],
        )
        self.assertEqual(result["present"], [])
        self.assertIn("ken_m_0_2021_1km_UNadj.tif", result["missing"])

    def test_all_present(self):
        """When all expected files are present, missing list is empty."""
        filenames = [
            "ken_m_0_2021_1km_UNadj.tif",
            "ken_m_1_2021_1km_UNadj.tif",
            "ken_f_0_2021_1km_UNadj.tif",
            "ken_f_1_2021_1km_UNadj.tif",
        ]
        result = check_completeness(
            available_files=self._make_paths(filenames),
            years=[2021],
            sexes=["m", "f"],
            ages=[0, 1],
        )
        self.assertEqual(result["missing"], [])
        self.assertEqual(sorted(result["present"]), sorted(filenames))

    def test_partial_missing(self):
        """Partial availability correctly identifies the missing files."""
        present = [
            "ken_m_0_2021_1km_UNadj.tif",
            "ken_f_0_2021_1km_UNadj.tif",
        ]
        result = check_completeness(
            available_files=self._make_paths(present),
            years=[2021],
            sexes=["m", "f"],
            ages=[0, 5],
        )
        self.assertIn("ken_m_5_2021_1km_UNadj.tif", result["missing"])
        self.assertIn("ken_f_5_2021_1km_UNadj.tif", result["missing"])
        self.assertEqual(len(result["missing"]), 2)

    def test_multi_year_partial_missing(self):
        """Files missing for one year do not affect the count for other years."""
        present = [
            # All of 2021
            "ken_m_0_2021_1km_UNadj.tif",
            "ken_f_0_2021_1km_UNadj.tif",
            # Only male for 2022
            "ken_m_0_2022_1km_UNadj.tif",
        ]
        result = check_completeness(
            available_files=self._make_paths(present),
            years=[2021, 2022],
            sexes=["m", "f"],
            ages=[0],
        )
        self.assertNotIn("ken_m_0_2021_1km_UNadj.tif", result["missing"])
        self.assertNotIn("ken_f_0_2021_1km_UNadj.tif", result["missing"])
        self.assertIn("ken_f_0_2022_1km_UNadj.tif", result["missing"])

    def test_unrecognised_files_ignored(self):
        """Files with non-standard names do not appear in present or missing."""
        filenames = [
            "ken_m_0_2021_1km_UNadj.tif",
            "readme.txt",                   # should be ignored
            "some_other_raster.tif",        # should be ignored
        ]
        result = check_completeness(
            available_files=self._make_paths(filenames),
            years=[2021],
            sexes=["m"],
            ages=[0],
        )
        self.assertEqual(result["present"], ["ken_m_0_2021_1km_UNadj.tif"])


# ===========================================================================
# Test: check_negative_values
# ===========================================================================

class TestCheckNegativeValues(unittest.TestCase):
    """Tests for :func:`validation.check_negative_values`."""

    def setUp(self):
        """Create a temporary directory for test TIF files."""
        self._tmpdir = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmpdir.name)

    def tearDown(self):
        """Remove the temporary directory."""
        self._tmpdir.cleanup()

    def test_clean_raster_passes(self):
        """A raster with only non-negative values returns True."""
        data = np.array([[0.0, 1.5, 3.2], [0.8, 10.0, 5.0]], dtype=np.float32)
        path = self.tmpdir / "clean.tif"
        _write_tif(path, data)
        self.assertTrue(check_negative_values(path))

    def test_raster_with_negatives_fails(self):
        """A raster containing negative pixel values returns False."""
        data = np.array([[0.0, -1.5, 3.2], [0.8, 10.0, 5.0]], dtype=np.float32)
        path = self.tmpdir / "has_neg.tif"
        _write_tif(path, data)
        self.assertFalse(check_negative_values(path))

    def test_nodata_values_ignored(self):
        """No-data fill values (≤ -9999) are not flagged as negatives."""
        nodata_val = -9999.0
        data = np.array([[nodata_val, 1.5, 3.2], [0.8, nodata_val, 5.0]], dtype=np.float32)
        path = self.tmpdir / "nodata.tif"
        _write_tif(path, data, nodata=nodata_val)
        self.assertTrue(check_negative_values(path))

    def test_all_nodata_returns_true(self):
        """A raster consisting entirely of no-data passes (no valid negatives)."""
        nodata_val = -9999.0
        data = np.full((3, 3), nodata_val, dtype=np.float32)
        path = self.tmpdir / "all_nodata.tif"
        _write_tif(path, data, nodata=nodata_val)
        self.assertTrue(check_negative_values(path))

    def test_zero_values_are_not_negative(self):
        """Zero values are not considered negative — test returns True."""
        data = np.zeros((4, 4), dtype=np.float32)
        path = self.tmpdir / "zeros.tif"
        _write_tif(path, data)
        self.assertTrue(check_negative_values(path))

    def test_missing_file_raises(self):
        """Requesting a non-existent file raises FileNotFoundError."""
        with self.assertRaises(FileNotFoundError):
            check_negative_values(self.tmpdir / "nonexistent.tif")

    def test_single_negative_pixel_fails(self):
        """Even a single negative pixel (above the nodata threshold) triggers failure."""
        data = np.array([[100.0, 200.0], [300.0, -0.001]], dtype=np.float32)
        path = self.tmpdir / "one_neg.tif"
        _write_tif(path, data)
        self.assertFalse(check_negative_values(path))


# ===========================================================================
# Entry point
# ===========================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
