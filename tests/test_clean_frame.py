"""WHAT:      Stage-2 (clean) guards — frame-ingestion edge policy: malformed
           JSONL lines are skipped (not fatal), snapshot_date selection picks
           the majority day with ties going to the latest, and empty input
           still produces valid empty parquet/CSV + a success manifest.
WHY:       The ingestion layer decides what counts as data; a silently skipped
           line or a wrong snapshot day changes every downstream row, so each
           policy is pinned against tests/fixtures/sample_raw.jsonl edges.
INPUTS:    tests/fixtures/sample_raw.jsonl via tests/fixtures/clean_shared.py
           + src.clean.{frame,derive,cli} (tmp_path only; no DB, no network).
OUTPUTS:   pytest verdicts only; tmp_path artifacts in the empty-input test.
CALLERS:   `python -m pytest` — split from tests/test_clean.py 2026-10-22 with
           test names byte-identical (Verified-by anchors unchanged); suite
           baseline at split: 161 passed, 2 skipped.
"""

from __future__ import annotations

import json
from datetime import date

import pandas as pd

from src.clean.cli import main
from src.clean.derive import transform
from src.clean.frame import build_frame, pick_snapshot_date, read_jsonl
from tests.fixtures.clean_shared import EXPECTED_COLUMNS, FIXTURE


# --- edge cases -------------------------------------------------------------


def test_malformed_json_lines_are_skipped_not_fatal(tmp_path):
    broken = tmp_path / "listings.jsonl"
    lines = FIXTURE.read_text(encoding="utf-8").splitlines()
    broken.write_text(lines[0] + "\n" + "{not valid json\n" + lines[1] + "\n", encoding="utf-8")
    raw = read_jsonl(broken)
    assert raw.lines == 3
    assert raw.skipped == 1
    assert len(raw.records) == 2
    frame = transform(build_frame(raw.records))
    assert len(frame) == 2


def test_pick_snapshot_date_majority_and_tie():
    day13, day14 = date(2026, 10, 13), date(2026, 10, 14)
    assert pick_snapshot_date([day13, day14, day14, None]) == day14
    assert pick_snapshot_date([day13, day14]) == day14  # tie -> latest
    assert pick_snapshot_date([]) is None
    assert pick_snapshot_date([None, pd.NA]) is None


def test_empty_input_writes_valid_empty_outputs(tmp_path):
    raw_file = tmp_path / "listings.jsonl"
    raw_file.write_text("", encoding="utf-8")
    out_dir = tmp_path / "cleaned"
    assert main(["--in", str(raw_file), "--out", str(out_dir)]) == 0
    parquet_files = list(out_dir.glob("listings_*.parquet"))
    csv_files = list(out_dir.glob("listings_*.csv"))
    assert len(parquet_files) == len(csv_files) == 1
    frame = pd.read_parquet(parquet_files[0])
    assert len(frame) == 0
    for column in EXPECTED_COLUMNS:
        assert column in frame.columns
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "success"
    assert manifest["records_in"] == manifest["records_out"] == 0
