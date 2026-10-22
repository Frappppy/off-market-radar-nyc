"""WHAT:      CLI for stage 3 (store): ``python -m src.store`` — fail-fast
           config check, cleaned-dir read, three committed transactions
           (schema+marker / map+upsert / success+stale-mark), evidence files.
WHY:        The run must leave an auditable trail (manifest + process log)
           and a ``pipeline_runs`` row for every attempt, success or not.
INPUTS:     argv (``--in``, ``--out``, ``--run-id``, ``--skip-schema``);
           the cleaned directory on disk; ``DATABASE_URL``.
OUTPUTS:    ``store/manifest.json`` + ``process_log.md``; Postgres writes;
            exit codes 0 success · 1 runtime failure (pipeline_runs=failed)
            · 2 config/input failure (nothing written to the DB).
CALLERS:    ``python -m src.store`` (``__main__`` -> ``main``).
TESTED BY:  ``tests/test_store_cli.py`` (exit-code/config paths),
           ``tests/test_store_flow.py`` (success + failure DB flows).
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import psycopg

from ..common import runid
from ..common.evidence import append_log, iso, utc_now, write_manifest
from . import StoreError
from .args import parse_args
from .db import (
    STALE_RUNS,
    apply_schema,
    connect,
    finish_pipeline_run,
    get_database_url,
    mark_stale_listings,
    redact_dsn,
    start_pipeline_run,
    upsert_listings,
    upsert_snapshots,
)
from .loader import load_cleaned_dir, read_manifest
from .mapping import require_columns, listing_tuple, snapshot_tuple

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_CONFIG = 2

# --- run-id + record-count resolution ----------------------------------------


def resolve_run_id(explicit: str | None, in_dir: Path, manifest: dict) -> str:
    rid = manifest.get("run_id")
    manifest_run_id = rid.strip() if isinstance(rid, str) and rid.strip() else None
    parent = in_dir.parent.name if in_dir.name == "cleaned" else ""
    return runid.resolve_run_id(
        explicit=explicit,
        manifest_run_id=manifest_run_id,
        dir_run_id=parent or None,
        fallback=runid.utc_stamp(),
    )


def resolve_records_scraped(in_dir: Path) -> int | None:
    """raw manifest records_out, else cleaned manifest records_in, else None."""
    for directory, key in ((in_dir.parent / "raw", "records_out"), (in_dir, "records_in")):
        value = read_manifest(directory).get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


# --- evidence writers -------------------------------------------------------


def _write_evidence(
    out_dir: Path,
    run_id: str,
    started: datetime,
    finished: datetime,
    status: str,
    records_in: int,
    records_loaded: int,
) -> None:
    write_manifest(
        out_dir,
        {
            "stage": "store",
            "run_id": run_id,
            "records_in": records_in,
            "records_out": records_loaded,
            "started_at": iso(started),
            "finished_at": iso(finished),
            "status": status,
        },
    )


# --- main --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    # 1. fail fast on missing DATABASE_URL (Verified by: test_missing_database_url_exits_2)
    try:
        get_database_url()
    except StoreError as exc:
        print(f"src.store: ERROR: {exc}", file=sys.stderr)
        return EXIT_CONFIG

    in_dir = Path(args.input_dir)
    out_dir = Path(args.output_dir) if args.output_dir else in_dir.parent / "store"

    # 2. load input
    try:
        df, files = load_cleaned_dir(in_dir)
        require_columns(df, ("source", "listing_id", "scraped_at", "motivation_score"), "cleaned data")
        in_manifest = read_manifest(in_dir)
    except StoreError as exc:
        print(f"src.store: ERROR: {exc}", file=sys.stderr)
        return EXIT_CONFIG

    run_id = resolve_run_id(args.run_id, in_dir, in_manifest)
    records_scraped = resolve_records_scraped(in_dir)
    sources = sorted({str(s) for s in df["source"].dropna().unique()}) if len(df) else []
    source_field = ",".join(sources) if sources else None

    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / "process_log.md"
    started = utc_now()
    append_log(
        log_path,
        [
            f"## src.store - run_id `{run_id}`",
            f"- started_at: {iso(started)}",
            f"- input: `{in_dir}` ({', '.join(p.name for p in files)})",
            f"- records_in: {len(df)}",
            "- target: DATABASE_URL (value never logged)",
            f"- schema: {'skipped (--skip-schema)' if args.skip_schema else 'sql/schema.sql (idempotent)'}",
        ],
    )

    records_loaded = 0
    inactive_marked = 0
    status = "failed"
    exit_code = EXIT_FAILURE
    conn: psycopg.Connection | None = None

    try:
        conn = connect(get_database_url())
        with conn.transaction():  # transaction 1: schema + running marker (committed)
            if not args.skip_schema:
                apply_schema(conn)
            start_pipeline_run(conn, run_id, source_field)
        with conn.transaction():  # transaction 2: map + upsert (all-or-nothing; Verified by: test_failure_flow_marks_failed)
            listing_rows = [listing_tuple(row) for row in df.to_dict("records")]
            snapshot_rows = [snapshot_tuple(row) for row in df.to_dict("records")]
            upsert_listings(conn, listing_rows)
            upsert_snapshots(conn, snapshot_rows)
            records_loaded = len(snapshot_rows)
        with conn.transaction():  # transaction 3: mark success
            finish_pipeline_run(conn, run_id, "success", records_scraped, records_loaded, None)
            inactive_marked = mark_stale_listings(conn)
        status = "success"
        exit_code = EXIT_OK
        append_log(
            log_path,
            [
                "- pipeline_runs: status `running` -> `success`",
                f"- listings upserted (ON CONFLICT source,listing_id): {len(listing_rows)}",
                f"- listing_snapshots upserted (ON CONFLICT source,listing_id,snapshot_date): {records_loaded}",
                f"- records_scraped: {records_scraped if records_scraped is not None else 'unknown'}",
                f"- listings marked inactive (missed {STALE_RUNS} consecutive successful runs): {inactive_marked}",
            ],
        )
    except Exception as exc:  # noqa: BLE001 - converted to a clean stage failure
        notes = redact_dsn(f"{type(exc).__name__}: {exc}")[:1000]
        print(f"src.store: ERROR: {notes}", file=sys.stderr)
        append_log(log_path, [f"- ERROR: {notes}"])
        if conn is not None:
            try:
                conn.rollback()
                with conn.transaction():
                    finish_pipeline_run(conn, run_id, "failed", records_scraped, records_loaded, notes)
                append_log(log_path, ["- pipeline_runs: status -> `failed`"])
            except Exception as mark_exc:  # noqa: BLE001 - best effort only
                print(
                    f"src.store: WARNING: could not mark run failed: {mark_exc}",
                    file=sys.stderr,
                )
    finally:
        finished = utc_now()
        _write_evidence(out_dir, run_id, started, finished, status, len(df), records_loaded)
        append_log(log_path, [f"- finished_at: {iso(finished)}", f"- status: `{status}`", ""])
        if conn is not None:
            conn.close()

    return exit_code


__all__ = ["main", "parse_args", "resolve_records_scraped", "resolve_run_id"]
