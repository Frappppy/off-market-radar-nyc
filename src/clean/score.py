"""WHAT:      Stage-2 motivation scoring — the business rule ``score_one()``
           with its thresholds (``HIGH_DOM``, ``HIGH_DROP_PCT``), the shared
           null-safe helpers it and the rest of stage 2 rely on
           (``_is_missing``, ``_coerce_bool``).
WHY:        This is THE business rule of the project (REPO_MAP I1): High =
           DOM>90 AND drop>5%, Medium = XOR, Low = neither (strict ``>``).
           Keeping it in one small file makes the rule reviewable alone.
INPUTS:     ``days_on_market`` / ``price_drop_pct`` (any scalar, null-safe).
OUTPUTS:    ``(motivation_score, motivation_reason)``; helpers return
            ``bool | None`` / ``str | None``.
CALLERS:    ``src.clean.derive.transform`` (per-row scoring), ``tests/test_clean_score.py``.
TESTED BY:  ``tests/test_clean_score.py`` (score boundaries incl. null handling).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from ..common.coerce import TRUE_TOKENS_PERMISSIVE, text_to_bool

HIGH_DOM: int = 90
HIGH_DROP_PCT: float = 5.0


def _is_missing(value: Any) -> bool:
    """True for None / NA / NaN / NaT. Never raises on scalars.
    Verified by: test_score_one_null_safe_rules"""
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


def _fmt_pct(pct: float) -> str:
    """One decimal, e.g. ``7.1%`` (contract example). If rounding to one
    decimal would visually contradict the ``>5`` decision (values in
    (5, 5.05)), fall back to general formatting so the trace stays honest.
    Verified by: test_score_one_reason_examples (the 7.1% example); NOTHING
    (gap — the (5, 5.05) fallback branch is untested)."""
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
        return text_to_bool(value, true_tokens=TRUE_TOKENS_PERMISSIVE)
    return bool(value)


def score_one(days_on_market: Any, price_drop_pct: Any) -> tuple[str, str]:
    """Score one listing. Null-safe per contract: missing DOM counts as <= 90,
    missing drop as <= 5%. Returns (motivation_score, motivation_reason).
    Verified by: test_score_one_null_safe_rules (both-null -> Low)."""
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
