"""WHAT:      Mapping guards — cleaned DataFrame row -> SQL tuple for listings
           (13 columns) and snapshots (12): column order, coercion (zip from
           float, NaN->None, blank text->None, address fallback), rounding,
           and the required identity/enum/date fields that raise
           StoreError/MappingError.
WHY:       The stage-3 INSERTs interpolate these tuples POSITIONALLY (REPO_MAP
           I12), so a wrong value or order corrupts rows silently; tested
           against dict/pandas inputs only — no live DB.
INPUTS:    synthetic cleaned rows + src.store.mapping.
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — suite baseline: 155 passed, 2 skipped.
"""

from datetime import date, datetime, timezone

import pandas as pd
import pytest

from src.store import StoreError
from src.store.mapping import (
    LISTING_COLUMNS,
    SNAPSHOT_COLUMNS,
    MappingError,
    listing_tuple,
    require_columns,
    snapshot_tuple,
)


def _cleaned_row(**overrides):
    row = {
        "source": "zillow",
        "listing_id": "12345",
        "url": "https://www.zillow.com/homedetails/12345_x_z/",
        "address_raw": "  12 Main St ",
        "address_std": "12 MAIN ST",
        "city": "New York",
        "state": "NY",
        "zip": "10001",
        "latitude": 40.75,
        "longitude": -73.99,
        "price_current": 750000,
        "price_previous": 780000,
        "price_reduced": True,
        "property_type": "condo",
        "bedrooms": 2.0,
        "bathrooms": 1.0,
        "living_area_sqft": 1100,
        "days_on_market": 112,
        "scraped_at": "2026-10-14T14:30:00+00:00",
        "snapshot_date": "2026-10-14",
        "price_per_sqft": 681.818181,
        "price_drop_pct": 3.846153,
        "motivation_score": "High",
        "motivation_reason": "DOM=112>90 AND drop=3.8%>5",
    }
    row.update(overrides)
    return row


def test_listing_tuple_contract_columns():
    values = listing_tuple(_cleaned_row())
    assert len(values) == len(LISTING_COLUMNS) == 13
    row = dict(zip(LISTING_COLUMNS, values))
    assert row["source"] == "zillow"
    assert row["listing_id"] == "12345"
    assert row["address"] == "12 MAIN ST"
    assert row["zip"] == "10001"
    assert row["living_area_sqft"] == 1100
    assert row["url"].startswith("https://")


def test_listing_address_falls_back_to_raw_and_nan_to_none():
    row = _cleaned_row(address_std=None, latitude=float("nan"), longitude=None)
    values = listing_tuple(row)
    got = dict(zip(LISTING_COLUMNS, values))
    assert got["address"] == "12 Main St"  # trimmed raw kept when no std
    assert got["latitude"] is None
    assert got["longitude"] is None


def test_listing_zip_from_csv_float():
    got = dict(zip(LISTING_COLUMNS, listing_tuple(_cleaned_row(zip=10001.0))))
    assert got["zip"] == "10001"


def test_listing_skips_blank_text():
    got = dict(zip(LISTING_COLUMNS, listing_tuple(_cleaned_row(state="  "))))
    assert got["state"] is None


def test_listing_requires_identity():
    with pytest.raises(MappingError):
        listing_tuple(_cleaned_row(listing_id=None))


def test_snapshot_tuple_values_and_rounding():
    values = snapshot_tuple(_cleaned_row())
    assert len(values) == len(SNAPSHOT_COLUMNS) == 12
    got = dict(zip(SNAPSHOT_COLUMNS, values))
    assert got["price"] == 750000
    assert got["previous_price"] == 780000
    assert got["price_reduced"] is True
    assert got["days_on_market"] == 112
    assert got["price_per_sqft"] == 681.82
    assert got["price_drop_pct"] == 3.85
    assert got["motivation_score"] == "High"
    assert got["snapshot_date"] == date(2026, 10, 14)
    assert got["scraped_at"] == datetime(2026, 10, 14, 14, 30, tzinfo=timezone.utc)


def test_snapshot_null_safe():
    got = dict(
        zip(
            SNAPSHOT_COLUMNS,
            snapshot_tuple(
                _cleaned_row(
                    price_current=float("nan"),
                    price_previous=None,
                    price_reduced=float("nan"),
                    days_on_market=None,
                    price_per_sqft=None,
                    price_drop_pct=None,
                )
            ),
        )
    )
    assert got["price"] is None
    assert got["previous_price"] is None
    assert got["price_reduced"] is None
    assert got["days_on_market"] is None
    assert got["price_per_sqft"] is None
    assert got["price_drop_pct"] is None


def test_snapshot_date_accepts_date_and_yyyymmdd():
    assert dict(zip(SNAPSHOT_COLUMNS, snapshot_tuple(_cleaned_row(snapshot_date=date(2026, 10, 14)))))["snapshot_date"] == date(2026, 10, 14)
    assert dict(zip(SNAPSHOT_COLUMNS, snapshot_tuple(_cleaned_row(snapshot_date="20261014"))))["snapshot_date"] == date(2026, 10, 14)


def test_snapshot_naive_scraped_at_assumed_utc():
    got = dict(zip(SNAPSHOT_COLUMNS, snapshot_tuple(_cleaned_row(scraped_at="2026-10-14T14:30:00"))))
    assert got["scraped_at"].tzinfo == timezone.utc


def test_snapshot_rejects_bad_motivation_score():
    with pytest.raises(StoreError, match="motivation_score"):
        snapshot_tuple(_cleaned_row(motivation_score="ASAP"))


def test_snapshot_rejects_missing_snapshot_date_and_scraped_at():
    with pytest.raises(StoreError, match="snapshot_date"):
        snapshot_tuple(_cleaned_row(snapshot_date=None))
    with pytest.raises(StoreError, match="scraped_at"):
        snapshot_tuple(_cleaned_row(scraped_at=None))


def test_require_columns_reports_missing():
    df = pd.DataFrame({"source": ["zillow"]})
    with pytest.raises(MappingError, match="listing_id"):
        require_columns(df, ("source", "listing_id"), "cleaned data")


def test_roundtrip_through_dataframe():
    df = pd.DataFrame([_cleaned_row()])
    values = [listing_tuple(r) for r in df.to_dict("records")]
    snapshots = [snapshot_tuple(r) for r in df.to_dict("records")]
    assert values[0][0] == "zillow"
    assert snapshots[0][9] == "High"
