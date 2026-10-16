"""Tests for stage 2 (clean) — from the project folder, run with:
``..\\.venv\\Scripts\\python.exe -m pytest tests/ -q``
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from src.clean.cli import main
from src.clean.core import (
    RAW_COLUMNS,
    build_frame,
    clean_file,
    pick_snapshot_date,
    read_jsonl,
    score_one,
    transform,
)

ROOT = Path(__file__).resolve().parents[1]
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


@pytest.fixture(scope="module")
def cleaned() -> pd.DataFrame:
    return _load_cleaned()


def _row(frame: pd.DataFrame, listing_id: str):
    match = frame[frame["listing_id"] == listing_id]
    assert len(match) == 1, f"expected exactly one row for {listing_id}"
    return match.iloc[0]


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


# --- derived columns --------------------------------------------------------


def test_price_per_sqft_null_when_sqft_missing(cleaned):
    assert pd.isna(_row(cleaned, "Z-1005")["price_per_sqft"])


def test_price_per_sqft_null_when_sqft_zero(cleaned):
    assert pd.isna(_row(cleaned, "Z-1006")["price_per_sqft"])


def test_price_per_sqft_computed(cleaned):
    assert _row(cleaned, "Z-1001")["price_per_sqft"] == pytest.approx(464500 / 1200)


def test_price_drop_math(cleaned):
    row = _row(cleaned, "Z-1001")
    assert row["price_drop_abs"] == 35500
    assert row["price_drop_pct"] == pytest.approx(7.1, abs=1e-9)


def test_price_previous_null_keeps_site_flag(cleaned):
    """Z-1002: price_previous is null -> drop fields null, site flag preserved."""
    row = _row(cleaned, "Z-1002")
    assert pd.isna(row["price_drop_abs"])
    assert pd.isna(row["price_drop_pct"])
    assert bool(row["price_reduced"]) is True


def test_price_reduced_derived_from_prices_when_flag_missing(cleaned):
    """Z-1004: no site flag, but 350000 -> 345000 is a cut (contract OR-rule)."""
    row = _row(cleaned, "Z-1004")
    assert bool(row["price_reduced"]) is True


def test_snapshot_date_is_utc_date_of_scrape(cleaned):
    """All fixture rows are 2026-10-14 in UTC, including Z-1004 whose local
    scraped_at is 2026-10-13T22:00:00-05:00."""
    dates = {value for value in cleaned["snapshot_date"].tolist()}
    assert dates == {date(2026, 10, 14)}
    assert _row(cleaned, "Z-1004")["snapshot_date"] == date(2026, 10, 14)


def test_address_std_normalization(cleaned):
    assert _row(cleaned, "Z-1001")["address_std"] == "1001 MAIN STREET APT 4B"
    assert _row(cleaned, "Z-1010")["address_std"] == "55B OAK LANE"


def test_malformed_row_missing_address_does_not_crash(cleaned):
    row = _row(cleaned, "Z-1007")
    assert "address_raw" not in row or pd.isna(row["address_raw"])
    assert pd.isna(row["address_std"])
    assert row["motivation_score"] == "Low"
    assert len(cleaned) == 10


def test_property_type_passthrough_enum(cleaned):
    types = set(cleaned["property_type"].tolist())
    assert {"house", "condo", "co-op", "townhouse", "multi-family", "land", "other"} <= types


def test_price_history_dropped_and_columns_ordered(cleaned):
    assert "price_history" not in cleaned.columns
    assert list(cleaned.columns) == EXPECTED_COLUMNS


def test_dtypes(cleaned):
    dtypes = cleaned.dtypes
    assert str(dtypes["price_current"]) == "Int64"
    assert str(dtypes["price_previous"]) == "Int64"
    assert str(dtypes["living_area_sqft"]) == "Int64"
    assert str(dtypes["days_on_market"]) == "Int64"
    assert str(dtypes["price_drop_abs"]) == "Int64"
    assert str(dtypes["latitude"]) == "float64"
    assert str(dtypes["price_per_sqft"]) == "float64"
    assert str(dtypes["price_drop_pct"]) == "float64"
    assert str(dtypes["price_reduced"]) == "bool"
    assert "date32" in str(dtypes["snapshot_date"])
    assert str(dtypes["address_std"]) == "str"
    assert str(dtypes["motivation_score"]) == "str"
    assert str(dtypes["property_type"]) == "str"


def test_clean_file_stats(cleaned):
    frame, stats = clean_file(FIXTURE)
    assert len(frame) == len(cleaned)
    assert stats.records_in == stats.records_out == 10
    assert stats.lines == 10
    assert stats.skipped_lines == 0
    assert stats.snapshot_date == date(2026, 10, 14)
    assert stats.distinct_snapshot_dates == 1
    assert stats.dropped_columns == ["price_history"]
    assert stats.unknown_property_types == []


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


# --- CLI end-to-end ---------------------------------------------------------


def test_cli_writes_identical_csv_and_parquet(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    shutil.copy(FIXTURE, raw_dir / "listings.jsonl")
    out_dir = tmp_path / "cleaned"

    assert main(["--in", str(raw_dir), "--out", str(out_dir), "--run-id", "20261014-000000"]) == 0

    parquet_path = out_dir / "listings_2026-10-14.parquet"
    csv_path = out_dir / "listings_2026-10-14.csv"
    assert parquet_path.is_file()
    assert csv_path.is_file()

    parquet_df = pd.read_parquet(parquet_path)
    csv_df = pd.read_csv(csv_path)
    assert len(parquet_df) == len(csv_df) == 10
    assert list(parquet_df.columns) == list(csv_df.columns)
    assert parquet_df["motivation_score"].tolist() == csv_df["motivation_score"].tolist()
    assert parquet_df["motivation_reason"].tolist() == csv_df["motivation_reason"].tolist()
    assert set(parquet_df["property_type"]) == set(csv_df["property_type"])

    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert set(manifest) == {
        "stage",
        "run_id",
        "records_in",
        "records_out",
        "started_at",
        "finished_at",
        "status",
    }
    assert manifest["stage"] == "clean"
    assert manifest["run_id"] == "20261014-000000"
    assert manifest["status"] == "success"
    assert manifest["records_in"] == manifest["records_out"] == 10

    log = (out_dir / "process_log.md").read_text(encoding="utf-8")
    assert "# process log" in log
    assert "listings_2026-10-14.parquet" in log
    assert "10 rows" in log


def test_cli_missing_input_fails_cleanly(tmp_path):
    assert main(["--in", str(tmp_path / "nope"), "--out", str(tmp_path / "cleaned")]) == 1


def test_python_dash_m_module_invocation(tmp_path):
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "src.clean",
            "--in",
            str(FIXTURE),
            "--out",
            str(tmp_path / "cleaned"),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    assert (tmp_path / "cleaned" / "listings_2026-10-14.parquet").is_file()
    assert (tmp_path / "cleaned" / "listings_2026-10-14.csv").is_file()


def test_run_id_inferred_from_raw_manifest(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    shutil.copy(FIXTURE, raw_dir / "listings.jsonl")
    (raw_dir / "manifest.json").write_text(
        json.dumps({"stage": "scrape", "run_id": "20261014-143000"}), encoding="utf-8"
    )
    out_dir = tmp_path / "cleaned"
    assert main(["--in", str(raw_dir), "--out", str(out_dir)]) == 0
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["run_id"] == "20261014-143000"
    started = datetime.fromisoformat(manifest["started_at"].replace("Z", "+00:00"))
    assert started.tzinfo is not None
