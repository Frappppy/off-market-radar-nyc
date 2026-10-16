"""Pure row mapping: cleaned DataFrame row -> database tuples.

No database access here — this module is unit-tested in isolation
(tests/test_store_mapping.py).  Conversions are null-safe: pandas NaN/NaT/NA
and numpy scalars become plain Python values that psycopg can adapt.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any, Mapping

import pandas as pd

from . import StoreError

# Column order must match the INSERT statements in db.py.
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

_REQUIRED_LISTING = ("source", "listing_id")
_REQUIRED_SNAPSHOT = ("source", "listing_id", "snapshot_date", "scraped_at", "motivation_score")


class MappingError(StoreError):
    """A cleaned row cannot be mapped to the contract schema."""


def _py(value: Any) -> Any:
    """numpy/pandas scalar -> Python scalar; NaN/NaT/NA -> None."""
    if value is None:
        return None
    if isinstance(value, (list, tuple, dict)):  # e.g. raw price_history leaked in
        return value
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            value = value.item()  # numpy scalar -> python scalar
        except (ValueError, AttributeError):
            pass
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    try:
        if pd.isna(value):  # pd.NA, pd.NaT, None-in-object-dtype
            return None
    except (TypeError, ValueError):
        pass
    return value


def _text(value: Any) -> str | None:
    v = _py(value)
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))  # CSV may parse zip "10001" as 10001.0
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).strip()
    return s if s else None


def _float(value: Any) -> float | None:
    v = _py(value)
    return None if v is None else float(v)


def _int(value: Any) -> int | None:
    v = _py(value)
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
        return int(float(v))
    f = float(v)
    return int(round(f))


def _bool(value: Any) -> bool | None:
    v = _py(value)
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "t", "1", "yes"):
            return True
        if s in ("false", "f", "0", "no"):
            return False
        raise MappingError(f"cannot interpret {value!r} as boolean")
    return bool(v)


def _date(value: Any) -> date | None:
    v = _py(value)
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%Y-%m-%d", "%Y%m%d"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        except ValueError:
            raise MappingError(f"cannot parse snapshot_date {v!r} (expected YYYY-MM-DD)")
    raise MappingError(f"unsupported snapshot_date type: {type(v).__name__}")


def _timestamp(value: Any, row_label: str) -> datetime:
    v = _py(value)
    if v is None:
        raise MappingError(f"{row_label}: scraped_at is required (NOT NULL)")
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
        except ValueError:
            raise MappingError(f"{row_label}: cannot parse scraped_at {v!r} (ISO 8601)")
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    raise MappingError(f"{row_label}: unsupported scraped_at type {type(v).__name__}")


def require_columns(df: pd.DataFrame, columns: tuple[str, ...], stage_label: str) -> None:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise MappingError(f"{stage_label}: cleaned data is missing column(s): {', '.join(missing)}")


def listing_tuple(row: Mapping[str, Any]) -> tuple:
    """contract listings row; address prefers the normalized address_std."""
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


def snapshot_tuple(row: Mapping[str, Any]) -> tuple:
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
