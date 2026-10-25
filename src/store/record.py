"""WHAT:      ``--record-failure`` mode of ``python -m src.store``: turn one
           run_id into a ``pipeline_runs`` row with ``status='failed'``.
WHY:        Stage 3 is the only writer of ``pipeline_runs``, but it only runs
           when stages 1-2 succeed — so every run that died while scraping left
           NO trace in the database, and ``/api/health`` reported
           ``runs_failed_30d: 0`` for a month of outages. This is the small
           reverse channel the orchestrator uses to close that gap; the
           ``_RECORD_FAILURE`` statement makes the call idempotent and unable
           to overwrite a run that stage 3 already finished itself.
INPUTS:     ``argparse.Namespace`` from ``src.store.args`` (``run_id`` required;
           optional ``note`` / ``source``) + ``DATABASE_URL``.
OUTPUTS:    exit 0 = row recorded · 1 = database refused · 2 = bad invocation;
            one human-readable line on stdout/stderr (a DSN is never printed).
CALLERS:    ``src.store.cli.main`` (dispatch) and, through it,
            ``scripts/run_daily.py`` as a subprocess.
TESTED BY:  ``tests/test_store_flow.py`` — ``record_failure`` mode wiring
            (run-row only, note redaction/cap, DB error, missing --run-id) and
            ``test_run_id_started_at_is_the_utc_moment_the_id_encodes``.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from ..common.runid import RUN_ID_RE
from . import StoreError
from .db import connect, get_database_url, record_failed_run

NOTE_LIMIT = 1000  # same cap the in-stage failure path uses for `notes`


def run_id_started_at(run_id: str) -> datetime | None:
    """The UTC moment a ``YYYYMMDD-HHMMSS`` run id encodes, else ``None``.

    ``None`` makes the statement fall back to ``now()``: a hand-invoked call
    with a non-standard id still gets a timestamp rather than a NULL row.
    Verified by: test_run_id_started_at_is_the_utc_moment_the_id_encodes
    """
    if not RUN_ID_RE.match(run_id):
        return None
    return datetime.strptime(run_id, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)


def clean_note(note: str | None) -> str | None:
    """Collapse to one line and cap at NOTE_LIMIT (DSN redaction is db-side)."""
    if not note:
        return None
    return " ".join(note.split())[:NOTE_LIMIT]


def main(args: argparse.Namespace) -> int:
    if not args.run_id:
        print(
            "src.store: ERROR: --record-failure needs --run-id "
            "(the pipeline_runs primary key)",
            file=sys.stderr,
        )
        return 2

    try:
        dsn = get_database_url()
    except StoreError as exc:
        print(f"src.store: ERROR: {exc}", file=sys.stderr)
        return 2

    try:
        conn = connect(dsn)
    except StoreError as exc:
        print(f"src.store: ERROR: {exc}", file=sys.stderr)
        return 1

    note = clean_note(args.note)
    try:
        with conn.transaction():
            record_failed_run(
                conn,
                args.run_id,
                source=args.source,
                note=note,
                started_at=run_id_started_at(args.run_id),
            )
    except Exception as exc:  # noqa: BLE001 - best-effort observability only
        conn.close()
        print(f"src.store: ERROR: could not record failure: {exc}", file=sys.stderr)
        return 1

    conn.close()
    print(f"src.store: pipeline_runs {args.run_id} -> failed ({note or 'no note'})")
    return 0


__all__ = ["clean_note", "main", "run_id_started_at"]
