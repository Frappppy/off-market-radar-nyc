"""WHAT:      Stage-2 (clean) guards — derived columns and the cleaned-frame
           contract: price_per_sqft / price_drop / price_reduced maths, the
           UTC snapshot-date policy, address normalisation, malformed-row
           resilience, column order, dtypes, and clean_file() run stats.
WHY:       These columns are what the store stage loads and the site renders;
           every threshold, dtype and column position is pinned against
           tests/fixtures/sample_raw.jsonl so a refactor cannot drift them.
INPUTS:    tests/fixtures/sample_raw.jsonl via tests/fixtures/clean_shared.py
           + src.clean.derive.{clean_file,transform} (the module-scoped
           `cleaned` fixture runs read_jsonl -> build_frame -> transform once).
OUTPUTS:   pytest verdicts only; no files written.
CALLERS:   `python -m pytest` — split from tests/test_clean.py 2026-10-22 with
           test names byte-identical (Verified-by anchors unchanged); suite
           baseline at split: 161 passed, 2 skipped.
"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from src.clean.derive import clean_file
from tests.fixtures.clean_shared import (
    EXPECTED_COLUMNS,
    FIXTURE,
    _load_cleaned,
    _row,
)


@pytest.fixture(scope="module")
def cleaned() -> pd.DataFrame:
    return _load_cleaned()


# --- derived columns --------------------------------------------------------


def test_price_per_sqft_null_when_sqft_missing(cleaned):
    assert pd.isna(_row(cleaned, "Z-1005")["price_per_sqft"])


def test_price_per_sqft_null_when_sqft_zero(cleaned):
    assert pd.isna(_row(cleaned, "Z-1006")["price_per_sqft"])


def test_price_per_sqft_computed(cleaned):
    assert _row(cleaned, "Z-1001")["price_per_sqft"] == pytest.approx(464500 / 1200)


def test_price_drop_math(cleaned):
    row = _row(cleaned, "Z-1001")
    assert row["price_drop_abs"] == 35500
    assert row["price_drop_pct"] == pytest.approx(7.1, abs=1e-9)


def test_price_previous_null_keeps_site_flag(cleaned):
    """Z-1002: price_previous is null -> drop fields null, site flag preserved."""
    row = _row(cleaned, "Z-1002")
    assert pd.isna(row["price_drop_abs"])
    assert pd.isna(row["price_drop_pct"])
    assert bool(row["price_reduced"]) is True


def test_price_reduced_derived_from_prices_when_flag_missing(cleaned):
    """Z-1004: no site flag, but 350000 -> 345000 is a cut (contract OR-rule)."""
    row = _row(cleaned, "Z-1004")
    assert bool(row["price_reduced"]) is True


def test_snapshot_date_is_utc_date_of_scrape(cleaned):
    """All fixture rows are 2026-10-14 in UTC, including Z-1004 whose local
    scraped_at is 2026-10-13T22:00:00-05:00."""
    dates = {value for value in cleaned["snapshot_date"].tolist()}
    assert dates == {date(2026, 10, 14)}
    assert _row(cleaned, "Z-1004")["snapshot_date"] == date(2026, 10, 14)


def test_address_std_normalization(cleaned):
    assert _row(cleaned, "Z-1001")["address_std"] == "1001 MAIN STREET APT 4B"
    assert _row(cleaned, "Z-1010")["address_std"] == "55B OAK LANE"


def test_malformed_row_missing_address_does_not_crash(cleaned):
    row = _row(cleaned, "Z-1007")
    assert "address_raw" not in row or pd.isna(row["address_raw"])
    assert pd.isna(row["address_std"])
    assert row["motivation_score"] == "Low"
    assert len(cleaned) == 10


def test_property_type_passthrough_enum(cleaned):
    types = set(cleaned["property_type"].tolist())
    assert {"house", "condo", "co-op", "townhouse", "multi-family", "land", "other"} <= types


def test_price_history_dropped_and_columns_ordered(cleaned):
    assert "price_history" not in cleaned.columns
    assert list(cleaned.columns) == EXPECTED_COLUMNS


def test_dtypes(cleaned):
    dtypes = cleaned.dtypes
    assert str(dtypes["price_current"]) == "Int64"
    assert str(dtypes["price_previous"]) == "Int64"
    assert str(dtypes["living_area_sqft"]) == "Int64"
    assert str(dtypes["days_on_market"]) == "Int64"
    assert str(dtypes["price_drop_abs"]) == "Int64"
    assert str(dtypes["latitude"]) == "float64"
    assert str(dtypes["price_per_sqft"]) == "float64"
    assert str(dtypes["price_drop_pct"]) == "float64"
    assert str(dtypes["price_reduced"]) == "bool"
    assert "date32" in str(dtypes["snapshot_date"])
    assert str(dtypes["address_std"]) == "str"
    assert str(dtypes["motivation_score"]) == "str"
    assert str(dtypes["property_type"]) == "str"


def test_clean_file_stats(cleaned):
    frame, stats = clean_file(FIXTURE)
    assert len(frame) == len(cleaned)
    assert stats.records_in == stats.records_out == 10
    assert stats.lines == 10
    assert stats.skipped_lines == 0
    assert stats.snapshot_date == date(2026, 10, 14)
    assert stats.distinct_snapshot_dates == 1
    assert stats.dropped_columns == ["price_history"]
    assert stats.unknown_property_types == []
