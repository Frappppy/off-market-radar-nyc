"""WHAT:      Stage-2 derived columns + the full-file driver — the 7 contract
           derived columns (``DERIVED_COLUMNS``, ``transform``), the
           ``CleanStats`` run statistics and ``clean_file`` (read JSONL ->
           clean frame + stats).
WHY:        Everything that ADDS to the frame or summarises a whole file lives
           here; pure frame typing lives in ``frame.py``, the scoring rule in
           ``score.py``.
INPUTS:     A typed frame from ``frame.build_frame`` / a raw JSONL path.
OUTPUTS:    Frame with the 7 derived columns in contract order;
            ``(frame, CleanStats)`` from ``clean_file``.
CALLERS:    ``src.clean.cli`` (``CleanStats``, ``clean_file``),
            ``tests/test_clean_derive.py``, ``tests/test_clean_frame.py``.
TESTED BY:  ``tests/test_clean_derive.py``; derived-column order in I2 parity
            (``tests/test_contract_parity.py``).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow as pa

from .frame import (
    DROPPED_COLUMNS,
    RAW_COLUMNS,
    build_frame,
    pick_snapshot_date,
    read_jsonl,
)
from .score import _is_missing, score_one

DERIVED_COLUMNS: tuple[str, ...] = (
    "address_std",
    "snapshot_date",
    "price_per_sqft",
    "price_drop_abs",
    "price_drop_pct",
    "motivation_score",
    "motivation_reason",
)

PROPERTY_TYPES: frozenset[str] = frozenset(
    {"house", "condo", "co-op", "townhouse", "multi-family", "land", "other"}
)

DATE32 = pd.ArrowDtype(pa.date32())


def _standardize_address(value: Any) -> str | None:
    """Uppercase, collapse all whitespace runs to single spaces, trim."""
    if _is_missing(value):
        return None
    return " ".join(str(value).upper().split())


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
