"""WHAT:      Stage-2 (clean) guards — motivation scoring rules and boundaries:
           the 90-DOM / 5%-drop High-Medium-Low thresholds, reason strings,
           null-safety, and the score_one() contract the site renders.
WHY:       These thresholds ARE the product rule (invariant I1); every boundary
           (DOM 90 vs 91, drop 5.0 vs 5.5, null DOM/drop) is pinned against
           tests/fixtures/sample_raw.jsonl so a refactor cannot drift them.
INPUTS:    tests/fixtures/sample_raw.jsonl via tests/fixtures/clean_shared.py
           + src.clean.score.score_one (the module-scoped `cleaned` fixture
           runs read_jsonl -> build_frame -> transform once).
OUTPUTS:   pytest verdicts only; no files written.
CALLERS:   `python -m pytest` — split from tests/test_clean.py 2026-10-22 with
           test names byte-identical (Verified-by anchors unchanged); suite
           baseline at split: 161 passed, 2 skipped.
"""

from __future__ import annotations

import pandas as pd
import pytest

from src.clean.score import score_one
from tests.fixtures.clean_shared import _load_cleaned, _row


@pytest.fixture(scope="module")
def cleaned() -> pd.DataFrame:
    return _load_cleaned()


# --- motivation rules -------------------------------------------------------


def test_high_motivation_with_reason(cleaned):
    row = _row(cleaned, "Z-1001")
    assert row["motivation_score"] == "High"
    assert row["motivation_reason"] == "DOM=112>90 AND drop=7.1%>5"


def test_high_boundary_dom_91_drop_5_5(cleaned):
    row = _row(cleaned, "Z-1009")
    assert row["motivation_score"] == "High"
    assert row["motivation_reason"] == "DOM=91>90 AND drop=5.5%>5"


def test_medium_via_dom_only(cleaned):
    row = _row(cleaned, "Z-1002")
    assert row["motivation_score"] == "Medium"
    assert row["motivation_reason"] == "DOM=120>90 AND drop=null<=5"
    assert pd.isna(row["price_drop_abs"]) and pd.isna(row["price_drop_pct"])


def test_medium_via_drop_only(cleaned):
    row = _row(cleaned, "Z-1003")
    assert row["motivation_score"] == "Medium"
    assert row["motivation_reason"] == "DOM=15<=90 AND drop=6.0%>5"
    assert row["days_on_market"] == 15


def test_low_when_neither_threshold_met(cleaned):
    row = _row(cleaned, "Z-1004")
    assert row["motivation_score"] == "Low"
    assert row["motivation_reason"] == "DOM=20<=90 AND drop=1.4%<=5"


def test_drop_exactly_5_pct_is_not_high(cleaned):
    """Strict `> 5`: a 5.0% drop alone stays Low."""
    row = _row(cleaned, "Z-1008")
    assert row["property_type"] == "co-op"
    assert row["motivation_score"] == "Low"
    assert row["motivation_reason"] == "DOM=8<=90 AND drop=5.0%<=5"


def test_both_dom_and_drop_null_is_low(cleaned):
    row = _row(cleaned, "Z-1006")
    assert row["motivation_score"] == "Low"
    assert row["motivation_reason"] == "DOM=null<=90 AND drop=null<=5"
    assert pd.isna(row["days_on_market"])
    assert pd.isna(row["price_drop_pct"])


def test_all_scores_in_contract_enum(cleaned):
    assert set(cleaned["motivation_score"].tolist()) <= {"High", "Medium", "Low"}
    assert cleaned["motivation_reason"].notna().all()


@pytest.mark.parametrize(
    "dom,pct,score",
    [
        (112, 7.1, "High"),
        (91, 5.5, "High"),
        (120, None, "Medium"),
        (None, 6.0, "Medium"),
        (15, 5.0, "Low"),
        (None, None, "Low"),
        (90, 5.0, "Low"),
    ],
)
def test_score_one_null_safe_rules(dom, pct, score):
    assert score_one(dom, pct)[0] == score


def test_score_one_reason_examples():
    assert score_one(112, 7.1) == (
        "High",
        "DOM=112>90 AND drop=7.1%>5",
    )
    assert score_one(None, None) == (
        "Low",
        "DOM=null<=90 AND drop=null<=5",
    )
