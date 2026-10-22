"""WHAT:      Stage-2 frame construction — the contract column constants
           (``RAW_COLUMNS`` + dtype groups), the raw JSONL reader
           (``read_jsonl``), the majority-``snapshot_date`` picker and
           ``build_frame`` (typed pass-through frame with every contract
           column guaranteed).
WHY:        The raw->tabular contract (docs/data_contract.md, REPO_MAP I2)
           lives here alone: field names never get renamed, and a missing
           field becomes a typed null instead of a crash.
INPUTS:     Raw stage-1 JSONL path / record dicts.
OUTPUTS:    ``RawRead`` (records + line stats); a typed ``pandas.DataFrame``.
CALLERS:    ``src.clean.derive`` (``transform``/``clean_file``),
            ``src.clean.cli``, ``tests/test_clean_frame.py``, ``tests/test_contract_parity.py``.
TESTED BY:  ``tests/test_clean_frame.py``, I2 parity in ``tests/test_contract_parity.py``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

import pandas as pd

from .score import _coerce_bool, _is_missing

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


def _fmt_str(value: Any) -> str | None:
    if _is_missing(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


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
    """One JSON object per line. Malformed lines are skipped, never raised.
    Verified by: test_malformed_json_lines_are_skipped_not_fatal"""
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
    Missing site flag falls back to the price comparison (then False).
    Verified by: test_price_reduced_derived_from_prices_when_flag_missing,
    test_price_previous_null_keeps_site_flag"""
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
    from the tabular frame (the raw JSONL remains the audit trail).
    Verified by: test_price_history_dropped_and_columns_ordered (+ test_dtypes)."""
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
            .round()  # null-safe: a malformed non-integral int must not raise. Verified by: NOTHING (gap)
            .astype("Int64")
        )
    frame["price_reduced"] = _resolve_price_reduced(frame).astype("bool")

    for column in extras:
        if frame[column].dtype == object:
            frame[column] = frame[column].map(_stabilize_extra).astype("str")
    return frame
