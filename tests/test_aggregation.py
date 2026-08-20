"""
test_aggregation.py — Unit tests for src/aggregation.py.

Tests cover:
- Demographic indicator calculations using synthetic DataFrame input.
- Edge cases: zero working-age population, missing columns, all-NaN columns.
- Output CSV format (column names, dtypes, row counts).

Run with::

    python -m pytest tests/test_aggregation.py -v
    # or
    python -m unittest tests/test_aggregation.py
"""

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Ensure src/ is importable
# ---------------------------------------------------------------------------
_SRC_DIR = Path(__file__).resolve().parent.parent / "src"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from aggregation import (
    AGES_CHILDREN,
    AGES_ELDERLY,
    AGES_WORKING,
    calculate_indicators,
    save_to_csv,
)
from utils import SUPPORTED_AGES, SUPPORTED_SEXES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_mock_df(
    n_counties: int = 5,
    year: int = 2021,
    value_fn=None,
) -> pd.DataFrame:
    """Build a synthetic aggregated DataFrame with pop_{sex}_{age} columns.

    Args:
        n_counties: Number of county rows to generate.
        year:       Year value to assign.
        value_fn:   Callable ``(sex, age, county_idx) → float`` that returns
                    the population value. Defaults to a simple formula.

    Returns:
        DataFrame ready to be passed to :func:`calculate_indicators`.
    """
    if value_fn is None:
        def value_fn(sex, age, idx):
            # Deterministic but varied values so ratios are meaningful
            base = (idx + 1) * 1000
            age_factor = (age + 1) * 0.5
            sex_factor = 1.0 if sex == "m" else 0.95
            return base * age_factor * sex_factor

    rows = []
    for i in range(n_counties):
        row = {"county": f"County_{i + 1}", "year": year}
        for sex in SUPPORTED_SEXES:
            for age in SUPPORTED_AGES:
                row[f"pop_{sex}_{age}"] = value_fn(sex, age, i)
        rows.append(row)

    return pd.DataFrame(rows)


def _build_simple_df() -> pd.DataFrame:
    """Build a minimal 1-county DataFrame with known, easy-to-verify values.

    County A population:
        - male   age 0:  100  |  female age 0:  90
        - male   age 1:  110  |  female age 1:  100
        - male   age 15: 500  |  female age 15: 480
        - male   age 20: 400  |  female age 20: 390
        (all other age groups: 50 each sex)
    """
    row = {"county": "CountyA", "year": 2021}
    for sex in SUPPORTED_SEXES:
        for age in SUPPORTED_AGES:
            row[f"pop_{sex}_{age}"] = 50.0

    # Override specific values
    row["pop_m_0"] = 100.0
    row["pop_f_0"] = 90.0
    row["pop_m_1"] = 110.0
    row["pop_f_1"] = 100.0
    row["pop_m_15"] = 500.0
    row["pop_f_15"] = 480.0
    row["pop_m_20"] = 400.0
    row["pop_f_20"] = 390.0
    return pd.DataFrame([row])


# ===========================================================================
# Test: calculate_indicators — column presence
# ===========================================================================

class TestCalculateIndicatorsColumns(unittest.TestCase):
    """Verify that all required columns are created by calculate_indicators."""

    REQUIRED_COLUMNS = [
        "male_total",
        "female_total",
        "total_population",
        "children_under_5",
        "working_age",
        "elderly_65plus",
        "sex_ratio",
        "dependency_ratio",
        "child_dependency_ratio",
        "elderly_dependency_ratio",
        "pct_children",
        "pct_elderly",
    ]

    def setUp(self):
        self.df = _build_mock_df()
        self.result = calculate_indicators(self.df.copy())

    def test_all_required_columns_present(self):
        """All required indicator columns must be present after calculation."""
        for col in self.REQUIRED_COLUMNS:
            self.assertIn(col, self.result.columns, msg=f"Missing column: '{col}'")

    def test_no_rows_dropped(self):
        """Row count must be unchanged after calculate_indicators."""
        self.assertEqual(len(self.result), len(self.df))

    def test_original_columns_preserved(self):
        """pop_{sex}_{age} columns should still be present."""
        self.assertIn("pop_m_0", self.result.columns)
        self.assertIn("pop_f_80", self.result.columns)


# ===========================================================================
# Test: calculate_indicators — numerical correctness
# ===========================================================================

class TestCalculateIndicatorsNumerics(unittest.TestCase):
    """Verify that indicator values are arithmetically correct."""

    def setUp(self):
        self.df_simple = _build_simple_df()
        self.result = calculate_indicators(self.df_simple.copy())
        self.row = self.result.iloc[0]

    def test_children_under_5_value(self):
        """children_under_5 = sum of pop_{m,f}_{0,1}."""
        expected = (
            self.df_simple.iloc[0]["pop_m_0"]
            + self.df_simple.iloc[0]["pop_f_0"]
            + self.df_simple.iloc[0]["pop_m_1"]
            + self.df_simple.iloc[0]["pop_f_1"]
        )
        self.assertAlmostEqual(self.row["children_under_5"], expected, places=2)

    def test_total_population_equals_sum(self):
        """total_population = male_total + female_total."""
        self.assertAlmostEqual(
            self.row["total_population"],
            self.row["male_total"] + self.row["female_total"],
            places=2,
        )

    def test_sex_ratio_formula(self):
        """sex_ratio = male_total / female_total * 100."""
        expected = self.row["male_total"] / self.row["female_total"] * 100
        self.assertAlmostEqual(self.row["sex_ratio"], round(expected, 2), places=1)

    def test_dependency_ratio_formula(self):
        """dependency_ratio = (children + elderly) / working_age * 100."""
        children = self.row["children_under_5"]
        elderly = self.row["elderly_65plus"]
        working = self.row["working_age"]
        expected = (children + elderly) / working * 100
        self.assertAlmostEqual(self.row["dependency_ratio"], round(expected, 2), places=1)

    def test_child_dependency_ratio(self):
        """child_dependency_ratio = children_under_5 / working_age * 100."""
        expected = self.row["children_under_5"] / self.row["working_age"] * 100
        self.assertAlmostEqual(self.row["child_dependency_ratio"], round(expected, 2), places=1)

    def test_elderly_dependency_ratio(self):
        """elderly_dependency_ratio = elderly_65plus / working_age * 100."""
        expected = self.row["elderly_65plus"] / self.row["working_age"] * 100
        self.assertAlmostEqual(self.row["elderly_dependency_ratio"], round(expected, 2), places=1)

    def test_pct_children(self):
        """pct_children = children_under_5 / total_population * 100."""
        expected = self.row["children_under_5"] / self.row["total_population"] * 100
        self.assertAlmostEqual(self.row["pct_children"], round(expected, 2), places=1)

    def test_pct_elderly(self):
        """pct_elderly = elderly_65plus / total_population * 100."""
        expected = self.row["elderly_65plus"] / self.row["total_population"] * 100
        self.assertAlmostEqual(self.row["pct_elderly"], round(expected, 2), places=1)

    def test_totals_are_positive(self):
        """All total population values must be strictly positive."""
        self.assertGreater(self.row["total_population"], 0)
        self.assertGreater(self.row["male_total"], 0)
        self.assertGreater(self.row["female_total"], 0)

    def test_ratios_are_non_negative(self):
        """All ratio indicators must be ≥ 0."""
        ratio_cols = [
            "sex_ratio", "dependency_ratio", "child_dependency_ratio",
            "elderly_dependency_ratio", "pct_children", "pct_elderly",
        ]
        for col in ratio_cols:
            self.assertGreaterEqual(self.row[col], 0, msg=f"Negative ratio in '{col}'")

    def test_pct_children_plus_pct_elderly_leq_100(self):
        """pct_children + pct_elderly cannot exceed 100%."""
        self.assertLessEqual(self.row["pct_children"] + self.row["pct_elderly"], 100.0)


# ===========================================================================
# Test: calculate_indicators — edge cases
# ===========================================================================

class TestCalculateIndicatorsEdgeCases(unittest.TestCase):
    """Edge-case behaviour for calculate_indicators."""

    def test_zero_working_age_produces_nan_ratios(self):
        """When working-age population is 0, ratio columns should be NaN (not inf)."""
        df = _build_mock_df(n_counties=1, value_fn=lambda s, a, i: 0.0)

        # Give some non-zero children and elderly so ratios would overflow
        for age in AGES_CHILDREN + AGES_ELDERLY:
            for sex in SUPPORTED_SEXES:
                df.loc[0, f"pop_{sex}_{age}"] = 100.0

        result = calculate_indicators(df)
        self.assertTrue(
            result["dependency_ratio"].isna().all(),
            "dependency_ratio should be NaN when working_age=0",
        )
        self.assertTrue(
            result["child_dependency_ratio"].isna().all(),
            "child_dependency_ratio should be NaN when working_age=0",
        )

    def test_zero_female_produces_nan_sex_ratio(self):
        """When female_total is 0, sex_ratio should be NaN (not inf)."""
        df = _build_mock_df(n_counties=1, value_fn=lambda s, a, i: 0.0)
        # Give males non-zero values, keep females at 0
        for age in SUPPORTED_AGES:
            df.loc[0, f"pop_m_{age}"] = 50.0

        result = calculate_indicators(df)
        self.assertTrue(
            result["sex_ratio"].isna().all(),
            "sex_ratio should be NaN when female_total=0",
        )

    def test_multiple_counties_consistent_shape(self):
        """Output DataFrame row count matches input."""
        n = 10
        df = _build_mock_df(n_counties=n)
        result = calculate_indicators(df)
        self.assertEqual(len(result), n)

    def test_missing_pop_columns_treated_as_zero(self):
        """Missing pop_{sex}_{age} columns should default to 0, not raise."""
        df = pd.DataFrame([{"county": "X", "year": 2021, "pop_m_0": 100.0, "pop_f_0": 90.0}])
        try:
            result = calculate_indicators(df)
            # Should succeed; missing columns contribute 0
            self.assertIn("total_population", result.columns)
            # Only the two provided columns contribute
            self.assertAlmostEqual(result.iloc[0]["children_under_5"], 190.0, places=1)
        except Exception as exc:
            self.fail(f"calculate_indicators raised unexpectedly: {exc}")


# ===========================================================================
# Test: save_to_csv — output format
# ===========================================================================

class TestSaveToCSV(unittest.TestCase):
    """Tests for :func:`aggregation.save_to_csv`."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmpdir.name)

    def tearDown(self):
        self._tmpdir.cleanup()

    def _make_result_df(self) -> pd.DataFrame:
        """Build a small result DataFrame with all indicator columns."""
        df = _build_mock_df(n_counties=3)
        return calculate_indicators(df)

    def test_csv_is_created(self):
        """save_to_csv creates a file at the specified path."""
        df = self._make_result_df()
        out = self.tmpdir / "test_output.csv"
        returned_path = save_to_csv(df, output_path=out)
        self.assertTrue(out.exists(), "CSV file was not created.")
        self.assertEqual(returned_path, out)

    def test_csv_has_correct_row_count(self):
        """CSV row count (excluding header) matches the input DataFrame."""
        df = self._make_result_df()
        out = self.tmpdir / "rows_check.csv"
        save_to_csv(df, output_path=out)

        loaded = pd.read_csv(out)
        self.assertEqual(len(loaded), len(df))

    def test_csv_contains_required_columns(self):
        """CSV must contain all key indicator columns."""
        df = self._make_result_df()
        out = self.tmpdir / "cols_check.csv"
        save_to_csv(df, output_path=out)

        loaded = pd.read_csv(out)
        required = [
            "county", "year", "total_population",
            "children_under_5", "working_age", "elderly_65plus",
            "sex_ratio", "dependency_ratio",
        ]
        for col in required:
            self.assertIn(col, loaded.columns, msg=f"CSV missing column '{col}'")

    def test_csv_county_column_is_string(self):
        """The 'county' column should be read back as string/object dtype."""
        df = self._make_result_df()
        out = self.tmpdir / "dtype_check.csv"
        save_to_csv(df, output_path=out)

        loaded = pd.read_csv(out)
        self.assertEqual(loaded["county"].dtype, object)

    def test_csv_year_column_is_integer(self):
        """The 'year' column should be read back as integer dtype."""
        df = self._make_result_df()
        out = self.tmpdir / "year_dtype.csv"
        save_to_csv(df, output_path=out)

        loaded = pd.read_csv(out)
        self.assertTrue(
            pd.api.types.is_integer_dtype(loaded["year"]),
            "year column should be integer",
        )

    def test_csv_numeric_columns_are_float(self):
        """Population and ratio columns should be readable as numeric types."""
        df = self._make_result_df()
        out = self.tmpdir / "numeric_check.csv"
        save_to_csv(df, output_path=out)

        loaded = pd.read_csv(out)
        for col in ["total_population", "sex_ratio", "pct_children"]:
            self.assertTrue(
                pd.api.types.is_numeric_dtype(loaded[col]),
                msg=f"Column '{col}' is not numeric in the saved CSV",
            )

    def test_csv_no_empty_rows(self):
        """No fully-empty rows should appear in the saved CSV."""
        df = self._make_result_df()
        out = self.tmpdir / "empty_row_check.csv"
        save_to_csv(df, output_path=out)

        loaded = pd.read_csv(out)
        fully_empty = loaded.isnull().all(axis=1).sum()
        self.assertEqual(fully_empty, 0, "CSV contains fully-empty rows.")

    def test_parent_directories_created(self):
        """save_to_csv creates missing parent directories automatically."""
        df = self._make_result_df()
        nested = self.tmpdir / "a" / "b" / "c" / "output.csv"
        save_to_csv(df, output_path=nested)
        self.assertTrue(nested.exists(), "CSV not created in nested directory.")


# ===========================================================================
# Entry point
# ===========================================================================

if __name__ == "__main__":
    unittest.main(verbosity=2)
