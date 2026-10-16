"""Loader tests: parquet preferred, csv fallback, filename-derived dates."""

import json

import pandas as pd
import pytest

from src.store import StoreError
from src.store.loader import load_cleaned_dir, read_manifest


def _rows(n=1):
    return [
        {
            "source": "zillow",
            "listing_id": str(100 + i),
            "snapshot_date": "2026-10-14",
            "scraped_at": "2026-10-14T14:30:00+00:00",
            "motivation_score": "Low",
            "zip": "10001",
        }
        for i in range(n)
    ]


def test_parquet_preferred_over_csv(tmp_path):
    pd.DataFrame(_rows(2)).to_parquet(tmp_path / "listings_2026-10-14.parquet", index=False)
    pd.DataFrame(_rows(5)).to_csv(tmp_path / "listings_2026-10-14.csv", index=False)
    df, files = load_cleaned_dir(tmp_path)
    assert [f.suffix for f in files] == [".parquet"]
    assert len(df) == 2  # csv ignored while parquet exists


def test_csv_fallback_reads_zip_as_string(tmp_path):
    pd.DataFrame(_rows(3)).to_csv(tmp_path / "listings_2026-10-14.csv", index=False)
    df, files = load_cleaned_dir(tmp_path)
    assert files[0].suffix == ".csv"
    assert len(df) == 3
    assert str(df["zip"].iloc[0]) == "10001"


def test_snapshot_date_derived_from_filename(tmp_path):
    df = pd.DataFrame(_rows(1)).drop(columns=["snapshot_date"])
    df.to_csv(tmp_path / "listings_2026-10-14.csv", index=False)
    loaded, _ = load_cleaned_dir(tmp_path)
    assert str(loaded["snapshot_date"].iloc[0]) == "2026-10-14"


def test_snapshot_date_from_compact_filename(tmp_path):
    df = pd.DataFrame(_rows(1)).drop(columns=["snapshot_date"])
    df.to_csv(tmp_path / "listings_20261014.csv", index=False)
    loaded, _ = load_cleaned_dir(tmp_path)
    assert str(loaded["snapshot_date"].iloc[0]) == "2026-10-14"


def test_missing_dir_and_missing_files(tmp_path):
    with pytest.raises(StoreError, match="input directory not found"):
        load_cleaned_dir(tmp_path / "nope")
    with pytest.raises(StoreError, match="no listings_"):
        load_cleaned_dir(tmp_path)


def test_multiple_parquet_files_concatenated(tmp_path):
    pd.DataFrame(_rows(1)).to_parquet(tmp_path / "listings_2026-10-13.parquet", index=False)
    pd.DataFrame(_rows(2)).to_parquet(tmp_path / "listings_2026-10-14.parquet", index=False)
    df, files = load_cleaned_dir(tmp_path)
    assert len(files) == 2
    assert len(df) == 3


def test_read_manifest(tmp_path):
    assert read_manifest(tmp_path) == {}
    payload = {"stage": "clean", "run_id": "20261014-143000", "records_in": 2}
    (tmp_path / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    assert read_manifest(tmp_path) == payload
