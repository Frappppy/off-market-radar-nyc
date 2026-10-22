"""WHAT:      CLI for stage 2 (clean): ``python -m src.clean --in <raw> --out <cleaned>``.

Reads ``jobs/<run_id>/raw/listings.jsonl`` and writes
``listings_<snapshot_date>.parquet`` + the same ``.csv``, plus
``manifest.json`` and ``process_log.md`` (docs/data_contract.md).
WHY:        argparse + orchestration only; the transform lives in
            ``derive.clean_file``, log text in ``processlog``.
INPUTS:     ``argv``: ``--in`` (raw dir or .jsonl), ``--out``, ``--run-id``.
OUTPUTS:    Exit code 0 = success, 1 = failure (with best-effort failure
            artifacts in ``--out``).
CALLERS:    ``python -m src.clean`` (``__main__``), ``scripts/run_daily.py``.
TESTED BY:  ``tests/test_clean.py::test_cli_writes_identical_csv_and_parquet``,
            ``::test_empty_input_writes_valid_empty_outputs``,
            ``::test_cli_missing_input_fails_cleanly`` (exit 1),
            ``::test_run_id_inferred_from_raw_manifest``.
Note (phase-2 gate fix): the process-log/failure writers (``_build_log``,
``_failed_log``, ``_write_failure_artifacts``, ``MANIFEST_KEYS``) moved
verbatim into ``processlog.py``.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from ..common import runid
from ..common.evidence import write_manifest
from ..common.timeutil import utc_now_iso
from .derive import clean_file
from .processlog import _build_log, _write_failure_artifacts


# --- argument helpers --------------------------------------------------------


def resolve_input(value: str) -> Path:
    """``--in`` accepts the raw dir (jobs/<run_id>/raw) or a .jsonl file."""
    path = Path(value)
    if path.is_dir():
        candidate = path / "listings.jsonl"
        if not candidate.is_file():
            raise FileNotFoundError(f"raw file not found: {candidate}")
        return candidate
    if path.is_file():
        return path
    raise FileNotFoundError(f"input not found: {path}")


def resolve_run_id(explicit: str | None, input_path: Path) -> str:
    if explicit:
        return explicit
    raw_dir = input_path.parent
    manifest_path = raw_dir / "manifest.json"
    manifest_run_id = None
    if manifest_path.is_file():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {}
        value = data.get("run_id")
        if isinstance(value, str) and value:
            manifest_run_id = value
    return runid.resolve_run_id(
        manifest_run_id=manifest_run_id,
        dir_run_id=runid.run_id_from_dir(raw_dir.parent),
        fallback="unknown",
    )


# --- main --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m src.clean",
        description=(
            "Stage 2 (clean): raw listings.jsonl -> typed, motivation-scored "
            "parquet + csv (+ manifest.json, process_log.md)"
        ),
    )
    parser.add_argument(
        "--in",
        dest="in_path",
        required=True,
        metavar="DIR",
        help="raw dir (jobs/<run_id>/raw) or a listings .jsonl file",
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        required=True,
        metavar="DIR",
        help="cleaned output dir (jobs/<run_id>/cleaned)",
    )
    parser.add_argument(
        "--run-id",
        dest="run_id",
        default=None,
        help="override the run_id written to manifest.json",
    )
    args = parser.parse_args(argv)

    started_at = utc_now_iso()
    out_dir = Path(args.out_path)

    try:
        input_path = resolve_input(args.in_path)
    except FileNotFoundError as exc:
        print(f"clean failed: {exc}", file=sys.stderr)
        return 1

    run_id = resolve_run_id(args.run_id, input_path)

    try:
        frame, stats = clean_file(input_path)
        fallback_note = None
        snapshot = stats.snapshot_date
        if snapshot is None:
            snapshot = datetime.now(timezone.utc).date()
            fallback_note = (
                "no valid `scraped_at` dates — using the current UTC date for "
                "the output filename; `snapshot_date` is null on every row"
            )

        out_dir.mkdir(parents=True, exist_ok=True)
        stem = f"listings_{snapshot.isoformat()}"
        parquet_path = out_dir / f"{stem}.parquet"
        csv_path = out_dir / f"{stem}.csv"
        frame.to_parquet(parquet_path, index=False)
        frame.to_csv(csv_path, index=False)

        files = [
            (parquet_path.name, len(frame), parquet_path.stat().st_size),
            (csv_path.name, len(frame), csv_path.stat().st_size),
        ]
        manifest = {
            "stage": "clean",
            "run_id": run_id,
            "records_in": stats.records_in,
            "records_out": stats.records_out,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "status": "success",
        }
        write_manifest(out_dir, manifest)
        (out_dir / "process_log.md").write_text(
            _build_log(
                run_id=run_id,
                started_at=started_at,
                finished_at=manifest["finished_at"],
                input_path=input_path,
                out_dir=out_dir,
                stats=stats,
                files=files,
                fallback_note=fallback_note,
            ),
            encoding="utf-8",
            newline="\n",
        )
        print(
            f"clean: {stats.records_out} records -> {parquet_path} "
            f"(+ .csv, manifest.json, process_log.md)"
        )
        if stats.skipped_lines:
            print(
                f"clean: skipped {stats.skipped_lines} malformed line(s), "
                f"see {out_dir / 'process_log.md'}",
                file=sys.stderr,
            )
        return 0
    except Exception:
        # any crash -> best-effort failure artifacts + exit 1
        # (this generic path is untested — see header / REPO_MAP §10)
        error = traceback.format_exc()
        _write_failure_artifacts(out_dir, run_id, started_at, input_path, error)
        print(f"clean failed: {error.strip().splitlines()[-1]}", file=sys.stderr)
        return 1
