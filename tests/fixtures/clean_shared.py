"""WHAT:      Shared helpers for the Stage-2 (clean) test modules — the fixture
           JSONL path, the expected cleaned-column contract, and the two
           row-loading helpers every clean test sits on.
WHY:       tests/test_clean.py was split by topic (score / derive / frame /
           CLI) with every test name kept byte-identical; the loader and
           _row() must live in exactly ONE place so the split cannot fork
           behaviour between files (REFACTOR_PLAN D1 split, 2026-10-22).
INPUTS:    tests/fixtures/sample_raw.jsonl + src.clean.{frame,derive} imports
           (values and functions only; no side effects at import time).
OUTPUTS:   ROOT, FIXTURE, EXPECTED_COLUMNS, _load_cleaned(), _row().
CALLERS:   tests/test_clean_score.py, tests/test_clean_derive.py,
           tests/test_clean_frame.py, tests/test_clean.py.
TESTED BY: every test taking the per-module `cleaned` fixture exercises
           _load_cleaned; every per-listing assertion goes through _row.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.clean.derive import transform
from src.clean.frame import RAW_COLUMNS, build_frame, read_jsonl

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "sample_raw.jsonl"

EXPECTED_COLUMNS = [c for c in RAW_COLUMNS if c != "price_history"] + [
    "address_std",
    "snapshot_date",
    "price_per_sqft",
    "price_drop_abs",
    "price_drop_pct",
    "motivation_score",
    "motivation_reason",
]


def _load_cleaned() -> pd.DataFrame:
    records = read_jsonl(FIXTURE).records
    return transform(build_frame(records))


def _row(frame: pd.DataFrame, listing_id: str):
    match = frame[frame["listing_id"] == listing_id]
    assert len(match) == 1, f"expected exactly one row for {listing_id}"
    return match.iloc[0]
