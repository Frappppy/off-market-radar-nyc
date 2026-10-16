"""Stage 2 (clean): raw JSONL -> typed, scored tabular dataset.

Implements ``docs/data_contract.md`` ("Stage 1 raw JSONL" / "Stage 2 clean").
Field names and scoring rules are taken from the contract and never renamed
here. Every transform is null-safe: a missing field must never raise.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd
import pyarrow as pa

# --- contract constants (docs/data_contract.md is law) ----------------------

RAW_COLUMNS: tuple[str, ...] = (
    "source",
    "listing_id",
    "url",
    "address_raw",
    "city",
    "state",
    "zip",
    "latitude",
    "longitude",
    "price_current",
    "price_previous",
    "price_reduced",
    "property_type",
    "bedrooms",
    "bathrooms",
    "living_area_sqft",
    "days_on_market",
    "listed_date",
    "price_history",
    "scraped_at",
)

#: nested audit trail — kept in the raw JSONL, dropped from tabular outputs
DROPPED_COLUMNS: tuple[str, ...] = ("price_history",)

DERIVED_COLUMNS: tuple[str, ...] = (
    "address_std",
    "snapshot_date",
    "price_per_sqft",
    "price_drop_abs",
    "price_drop_pct",
    "motivation_score",
    "motivation_reason",
)

STRING_COLUMNS: tuple[str, ...] = (
    "source",
    "listing_id",
    "url",
    "address_raw",
    "city",
    "state",
    "zip",
    "property_type",
    "listed_date",
    "scraped_at",
)
FLOAT_COLUMNS: tuple[str, ...] = ("latitude", "longitude", "bedrooms", "bathrooms")
INT_COLUMNS: tuple[str, ...] = (
    "price_current",
    "price_previous",
    "living_area_sqft",
    "days_on_market",
)

PROPERTY_TYPES: frozenset[str] = frozenset(
    {"house", "condo", "co-op", "townhouse", "multi-family", "land", "other"}
)

HIGH_DOM: int = 90
HIGH_DROP_PCT: float = 5.0

DATE32 = pd.ArrowDtype(pa.date32())


# --- small null-safe helpers -----------------------------------------------


def _is_missing(value: Any) -> bool:
    """True for None / NA / NaN / NaT. Never raises on scalars."""
    if value is None or value is pd.NA or value is pd.NaT:
        return True
    if isinstance(value, (str, bytes)):
        return False
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, (list, tuple, dict)):
        return False
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _fmt_str(value: Any) -> str | None:
    if _is_missing(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _standardize_address(value: Any) -> str | None:
    """Uppercase, collapse all whitespace runs to single spaces, trim."""
    if _is_missing(value):
        return None
    return " ".join(str(value).upper().split())


def _fmt_pct(pct: float) -> str:
    """One decimal, e.g. ``7.1%`` (contract example). If rounding to one
    decimal would visually contradict the ``>5`` decision (values in
    (5, 5.05)), fall back to general formatting so the trace stays honest."""
    text = f"{pct:.1f}%"
    if pct > HIGH_DROP_PCT and float(text[:-1]) <= HIGH_DROP_PCT:
        text = f"{pct:g}%"
    return text


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if _is_missing(value):
        return None
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    return bool(value)


# --- motivation scoring -----------------------------------------------------


def score_one(days_on_market: Any, price_drop_pct: Any) -> tuple[str, str]:
    """Score one listing. Null-safe per contract: missing DOM counts as <= 90,
    missing drop as <= 5%. Returns (motivation_score, motivation_reason)."""
    dom_missing = _is_missing(days_on_market)
    dom_high = (not dom_missing) and float(days_on_market) > HIGH_DOM
    drop_missing = _is_missing(price_drop_pct)
    drop_high = (not drop_missing) and float(price_drop_pct) > HIGH_DROP_PCT

    if dom_high and drop_high:
        score = "High"
    elif dom_high or drop_high:
        score = "Medium"
    else:
        score = "Low"

    dom_text = "null" if dom_missing else _fmt_dom(days_on_market)
    drop_text = "null" if drop_missing else _fmt_pct(float(price_drop_pct))
    reason = (
        f"DOM={dom_text}{'>90' if dom_high else '<=90'}"
        f" AND drop={drop_text}{'>5' if drop_high else '<=5'}"
    )
    return score, reason


def _fmt_dom(value: Any) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)


def pick_snapshot_date(values: Iterable[Any]) -> date | None:
    """Majority UTC date across rows (ties -> latest). None if no valid date."""
    counts: dict[date, int] = {}
    for value in values:
        if _is_missing(value):
            continue
        day = value.date() if isinstance(value, (datetime, pd.Timestamp)) else value
        counts[day] = counts.get(day, 0) + 1
    if not counts:
        return None
    top = max(counts.values())
    return max(day for day, count in counts.items() if count == top)


# --- stage-1 read -----------------------------------------------------------


@dataclass
class RawRead:
    records: list[dict] = field(default_factory=list)
    lines: int = 0
    skipped: int = 0


def read_jsonl(path: str | Path) -> RawRead:
    """One JSON object per line. Malformed lines are skipped, never raised."""
    result = RawRead()
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            result.lines += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                result.skipped += 1
                continue
            if not isinstance(obj, dict):
                result.skipped += 1
                continue
            result.records.append(obj)
    return result


# --- frame construction -----------------------------------------------------


def _resolve_price_reduced(frame: pd.DataFrame) -> pd.Series:
    """Contract: site "Price cut" flag OR price_previous > price_current.
    Missing site flag falls back to the price comparison (then False)."""
    n_rows = len(frame)
    site_values = (
        frame["price_reduced"].tolist() if "price_reduced" in frame.columns else [None] * n_rows
    )
    previous_values = frame["price_previous"].tolist() if "price_previous" in frame.columns else [None] * n_rows
    current_values = frame["price_current"].tolist() if "price_current" in frame.columns else [None] * n_rows
    resolved: list[bool] = []
    for site_value, previous, current in zip(site_values, previous_values, current_values):
        flag = _coerce_bool(site_value)
        price_cut = (
            (not _is_missing(previous))
            and (not _is_missing(current))
            and bool(previous > current)
        )
        resolved.append(bool(flag) or price_cut)
    return pd.Series(resolved, index=frame.index, dtype="bool")


def _stabilize_extra(value: Any) -> str | None:
    if _is_missing(value):
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list, bool, int, float)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


def build_frame(records: Sequence[dict]) -> pd.DataFrame:
    """Raw pass-through with contract dtypes. Guarantees every contract column
    exists (absent fields become typed nulls). Extra scraper fields are kept
    after the contract columns; the nested ``price_history`` list is dropped
    from the tabular frame (the raw JSONL remains the audit trail)."""
    frame = pd.DataFrame(list(records)) if records else pd.DataFrame()
    extras = [column for column in frame.columns if column not in RAW_COLUMNS]
    keep = [column for column in RAW_COLUMNS if column not in DROPPED_COLUMNS] + extras
    frame = frame.reindex(columns=keep)

    for column in STRING_COLUMNS:
        frame[column] = frame[column].map(_fmt_str).astype("str")
    for column in FLOAT_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").astype("float64")
    for column in INT_COLUMNS:
        frame[column] = (
            pd.to_numeric(frame[column], errors="coerce")
            .astype("float64")
            .round()  # null-safe: a malformed non-integral int must not raise
            .astype("Int64")
        )
    frame["price_reduced"] = _resolve_price_reduced(frame).astype("bool")

    for column in extras:
        if frame[column].dtype == object:
            frame[column] = frame[column].map(_stabilize_extra).astype("str")
    return frame


# --- derived columns --------------------------------------------------------


def _snapshot_dates(scraped: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(scraped, utc=True, errors="coerce")
    values: list[date | None] = [
        None if _is_missing(timestamp) else timestamp.date() for timestamp in parsed
    ]
    return pd.Series(values, index=scraped.index, dtype=DATE32)


def _price_per_sqft(frame: pd.DataFrame) -> pd.Series:
    current = frame["price_current"].astype("float64")
    sqft = frame["living_area_sqft"].astype("float64")
    valid = current.notna() & sqft.notna() & (sqft != 0)
    result = pd.Series(np.nan, index=frame.index, dtype="float64")
    result.loc[valid] = current[valid] / sqft[valid]
    return result


def _price_drop_pct(frame: pd.DataFrame) -> pd.Series:
    previous = frame["price_previous"].astype("float64")
    dropped = frame["price_drop_abs"].astype("float64")
    valid = previous.notna() & (previous != 0) & dropped.notna()
    result = pd.Series(np.nan, index=frame.index, dtype="float64")
    result.loc[valid] = (dropped[valid] / previous[valid]) * 100.0
    return result


def transform(frame: pd.DataFrame) -> pd.DataFrame:
    """Add the contract's derived columns to a :func:`build_frame` output."""
    out = frame.copy()
    out["address_std"] = out["address_raw"].map(_standardize_address).astype("str")
    out["snapshot_date"] = _snapshot_dates(out["scraped_at"])
    out["price_per_sqft"] = _price_per_sqft(out)
    out["price_drop_abs"] = (out["price_previous"] - out["price_current"]).astype("Int64")
    out["price_drop_pct"] = _price_drop_pct(out)

    scores: list[str] = []
    reasons: list[str] = []
    for dom, pct in zip(out["days_on_market"].tolist(), out["price_drop_pct"].tolist()):
        score, reason = score_one(dom, pct)
        scores.append(score)
        reasons.append(reason)
    out["motivation_score"] = pd.Series(scores, index=out.index, dtype="str")
    out["motivation_reason"] = pd.Series(reasons, index=out.index, dtype="str")

    extras = [
        column
        for column in out.columns
        if column not in RAW_COLUMNS and column not in DERIVED_COLUMNS
    ]
    ordered = (
        [column for column in RAW_COLUMNS if column not in DROPPED_COLUMNS]
        + extras
        + list(DERIVED_COLUMNS)
    )
    return out[ordered]


# --- full pipeline ----------------------------------------------------------


@dataclass
class CleanStats:
    input_path: Path
    lines: int
    records_in: int
    skipped_lines: int
    records_out: int
    extra_columns: list[str]
    dropped_columns: list[str]
    price_history_rows: int
    reduced_flag_missing: int
    unknown_property_types: list[str]
    snapshot_date: date | None
    distinct_snapshot_dates: int


def clean_file(path: str | Path) -> tuple[pd.DataFrame, CleanStats]:
    """Read a raw JSONL file and return the clean frame plus run statistics."""
    path = Path(path)
    raw = read_jsonl(path)
    frame = transform(build_frame(raw.records))

    days = [value for value in frame["snapshot_date"].tolist() if not _is_missing(value)]
    extras = sorted({key for record in raw.records for key in record} - set(RAW_COLUMNS))
    dropped = [column for column in DROPPED_COLUMNS if any(column in r for r in raw.records)]
    history_rows = sum(1 for record in raw.records if record.get("price_history"))
    flag_missing = sum(
        1 for record in raw.records if not isinstance(record.get("price_reduced"), bool)
    )
    property_types = {
        record["property_type"] for record in raw.records if isinstance(record.get("property_type"), str)
    }

    stats = CleanStats(
        input_path=path,
        lines=raw.lines,
        records_in=len(raw.records),
        skipped_lines=raw.skipped,
        records_out=len(frame),
        extra_columns=extras,
        dropped_columns=dropped,
        price_history_rows=history_rows,
        reduced_flag_missing=flag_missing,
        unknown_property_types=sorted(property_types - PROPERTY_TYPES),
        snapshot_date=pick_snapshot_date(frame["snapshot_date"]),
        distinct_snapshot_dates=len(set(days)),
    )
    return frame, stats


RUN_ID_RE = re.compile(r"^\d{8}-\d{6}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
