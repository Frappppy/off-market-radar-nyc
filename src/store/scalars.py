"""WHAT:      Scalar coercion helpers behind the row mappers — ``_py`` (raw cell
           -> plain Python scalar), plus typed text/float/int/bool/date/
           timestamp converters.
WHY:        Split (phase 2) from the 220-line ``mapping.py`` (gate fix: no file
           >200 lines); the row mappers stay in ``mapping.py`` and import these
           helpers, so every public import path is unchanged. Bodies and error
           messages moved verbatim.
INPUTS:     Raw cell values from the cleaned DataFrame (numpy/pandas scalars,
            NaN/NaT/NA, strings).
OUTPUTS:    ``None``-safe Python scalars; ``MappingError`` on unusable values.
CALLERS:    ``src.store.mapping`` only (``listing_tuple``/``snapshot_tuple``/
            ``require_columns``); re-exported names: ``MappingError``.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd

from ..common.coerce import FALSE_TOKENS_STRICT, TRUE_TOKENS_STRICT, text_to_bool
from . import StoreError

# --- error type --------------------------------------------------------------


class MappingError(StoreError):
    """A cleaned row cannot be mapped to the contract schema."""


# --- null-safe cell coercion -------------------------------------------------


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
        return text_to_bool(
            v,
            true_tokens=TRUE_TOKENS_STRICT,
            false_tokens=FALSE_TOKENS_STRICT,
            on_unknown="raise",
            error_type=MappingError,
        )
    return bool(v)


# --- date / timestamp coercion -----------------------------------------------


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
