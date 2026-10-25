"""WHAT:      Pure row mapping — cleaned DataFrame row -> database tuples
           (``require_columns``, ``listing_tuple``, ``snapshot_tuple``).
WHY:        Every null/enum/NOTNULL decision for the two upserts lives in
           one reviewable place; conversions are null-safe so pandas
           NaN/NaT/NA and numpy scalars become plain Python values that
           psycopg can adapt. No database access here — unit-testable alone.
INPUTS:     A cleaned row as ``Mapping[Any, Any]`` (``df.to_dict("records")`` —
            pandas keys it ``Hashable`` in some releases and ``str`` in others,
            and these readers only ever look up literal column names).
OUTPUTS:    13-tuple (listings) / 12-tuple (snapshots); ``MappingError``
           (imported from ``scalars``) on unusable rows.
CALLERS:    ``src.store.cli`` (per-row before each upsert transaction).
TESTED BY:  ``tests/test_store_mapping.py`` (contract columns, null-safety,
           enum/NOTNULL rejection, dataframe roundtrip).

Phase-2 gate fix: the scalar coercion helpers (``_py``/``_text``/``_float``/
``_int``/``_bool``/``_date``/``_timestamp``) and ``MappingError`` moved
verbatim into ``scalars.py`` and are imported below, so every public import
path (``mapping.MappingError``, ``mapping.listing_tuple``, ...) is unchanged.
"""

from __future__ import annotations

from typing import Any, Mapping

import pandas as pd

from .scalars import (
    MappingError,
    _bool,
    _date,
    _float,
    _int,
    _timestamp,
    _text,
)

# --- column contracts -------------------------------------------------------

# Column order must match the INSERT statements in db.py.
#: Verified by: test_mapping_listing_columns_match_schema,
#:             test_mapping_snapshot_columns_match_schema
LISTING_COLUMNS: tuple[str, ...] = (
    "source",
    "listing_id",
    "address",
    "city",
    "state",
    "zip",
    "latitude",
    "longitude",
    "property_type",
    "bedrooms",
    "bathrooms",
    "living_area_sqft",
    "url",
)

SNAPSHOT_COLUMNS: tuple[str, ...] = (
    "source",
    "listing_id",
    "snapshot_date",
    "price",
    "previous_price",
    "price_reduced",
    "days_on_market",
    "price_per_sqft",
    "price_drop_pct",
    "motivation_score",
    "motivation_reason",
    "scraped_at",
)

MOTIVATION_SCORES = ("High", "Medium", "Low")

# --- validation -------------------------------------------------------------


def require_columns(df: pd.DataFrame, columns: tuple[str, ...], stage_label: str) -> None:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise MappingError(f"{stage_label}: cleaned data is missing column(s): {', '.join(missing)}")


# --- row mappers ------------------------------------------------------------


def listing_tuple(row: Mapping[Any, Any]) -> tuple:
    """contract listings row; address prefers the normalized address_std.
    Verified by: test_listing_address_falls_back_to_raw_and_nan_to_none"""
    source = _text(row.get("source"))
    listing_id = _text(row.get("listing_id"))
    if source is None or listing_id is None:
        raise MappingError(f"row without source/listing_id: {dict(row)!r}")
    address = _text(row.get("address_std")) or _text(row.get("address_raw"))
    return (
        source,
        listing_id,
        address,
        _text(row.get("city")),
        _text(row.get("state")),
        _text(row.get("zip")),
        _float(row.get("latitude")),
        _float(row.get("longitude")),
        _text(row.get("property_type")),
        _float(row.get("bedrooms")),
        _float(row.get("bathrooms")),
        _int(row.get("living_area_sqft")),
        _text(row.get("url")),
    )


def snapshot_tuple(row: Mapping[Any, Any]) -> tuple:
    source = _text(row.get("source"))
    listing_id = _text(row.get("listing_id"))
    if source is None or listing_id is None:
        raise MappingError(f"row without source/listing_id: {dict(row)!r}")
    label = f"{source}/{listing_id}"
    snapshot_date = _date(row.get("snapshot_date"))
    if snapshot_date is None:
        raise MappingError(f"{label}: snapshot_date is required (NOT NULL)")
    score = _text(row.get("motivation_score"))
    if score not in MOTIVATION_SCORES:
        raise MappingError(
            f"{label}: motivation_score {score!r} not in {MOTIVATION_SCORES} (CHECK constraint)"
        )
    pps = _float(row.get("price_per_sqft"))
    drop = _float(row.get("price_drop_pct"))
    return (
        source,
        listing_id,
        snapshot_date,
        _int(row.get("price_current")),
        _int(row.get("price_previous")),
        _bool(row.get("price_reduced")),
        _int(row.get("days_on_market")),
        None if pps is None else round(pps, 2),
        None if drop is None else round(drop, 2),
        score,
        _text(row.get("motivation_reason")),
        _timestamp(row.get("scraped_at"), label),
    )
