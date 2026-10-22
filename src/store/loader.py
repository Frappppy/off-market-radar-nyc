"""WHAT:      Stage-3 input reader — the cleaned-stage output directory
           (parquet preferred, csv fallback) and its ``manifest.json``.
WHY:        The store stage must accept exactly what stage 2 writes
           (``jobs/<run_id>/cleaned/listings_<snapshot_date>.*``); keeping
           the file-choice, date-derivation and concat rules here means
           ``cli.main`` never touches the filesystem itself.
INPUTS:     A ``Path`` to a cleaned directory (files on disk; no network).
OUTPUTS:    ``(DataFrame, files_read)`` from ``load_cleaned_dir``; manifest
           ``dict`` (``{}`` when absent) from ``read_manifest``.
CALLERS:    ``src.store.cli`` (``load_cleaned_dir``, ``read_manifest``).
TESTED BY:  ``tests/test_store_loader.py`` (parquet-wins, csv fallback,
           filename date derivation, concat, missing-dir errors).
Contract: jobs/<run_id>/cleaned/listings_<snapshot_date>.parquet (+ .csv).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from . import StoreError

_FILE_DATE_RE = re.compile(r"listings_(\d{4}-\d{2}-\d{2}|\d{8})(?:\.|_)")


def read_manifest(directory: Path) -> dict:
    path = directory / "manifest.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StoreError(f"cannot read {path}: {exc}") from exc
    return data if isinstance(data, dict) else {}


def _date_from_filename(path: Path) -> str | None:
    m = _FILE_DATE_RE.search(path.name)
    if not m:
        return None
    raw = m.group(1)
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}" if "-" not in raw else raw


def _read_one(path: Path) -> pd.DataFrame:
    try:
        if path.suffix == ".parquet":
            df = pd.read_parquet(path)
        else:
            df = pd.read_csv(path, dtype={"zip": "string"})
    except Exception as exc:  # noqa: BLE001 - surface as a clean stage error
        raise StoreError(f"cannot read {path.name}: {exc}") from exc
    if "snapshot_date" not in df.columns:
        derived = _date_from_filename(path)
        if derived is None:
            raise StoreError(
                f"{path.name}: no snapshot_date column and no date in filename "
                "(expected listings_YYYY-MM-DD.*)"
            )
        df["snapshot_date"] = derived
    return df


def load_cleaned_dir(in_dir: Path) -> tuple[pd.DataFrame, list[Path]]:
    """Return (all cleaned rows, files actually read).

    Parquet wins when both formats exist (contract: parquet preferred).
    Verified by: test_parquet_preferred_over_csv.
    """
    if not in_dir.is_dir():
        raise StoreError(f"input directory not found: {in_dir}")
    parquet_files = sorted(in_dir.glob("listings_*.parquet"))
    csv_files = sorted(in_dir.glob("listings_*.csv"))
    files = parquet_files or csv_files
    if not files:
        raise StoreError(f"no listings_*.parquet or listings_*.csv in {in_dir}")
    frames = [_read_one(p) for p in files]
    df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    return df, files
