"""WHAT:      Stage-3 Postgres access — connection, idempotent upserts,
           ``pipeline_runs`` bookkeeping (start / finish / ``record_failed_run``
           for runs that never reached this stage), and stale-listing
           (``is_active``) marking. SQL text itself lives in ``statements.py``
           (re-imported here, so ``db._MARK_STALE`` etc. still resolve).
WHY:        One owner for every database side effect of stage 3; the CLI
           orchestrates, this module executes parameterized SQL only.
INPUTS:     A DSN string (from ``get_database_url``: env wins, else the
           gitignored ``config/database.local.env``) + row tuples from
           ``mapping``.
OUTPUTS:    Upserted/mutated rows; row counts returned to the CLI for the
           process log; ``StoreError`` on connection/config failures.
CALLERS:    ``src.store.cli``, ``src.store.record``; SQL-text assertions in
            ``tests/test_schema_sqlglot.py``, ``tests/test_store_db.py``,
           ``tests/test_store_stale.py`` (via ``db.*``).
TESTED BY:  ``tests/test_store_db.py`` (redaction, DSN precedence),
           ``tests/test_schema_sqlglot.py`` (upsert semantics incl.
           ``_START_RUN``, ``test_record_failure_sql_never_overwrites_a_terminal_run``),
           ``tests/test_store_stale.py`` (mark-stale).

All queries are parameterized (psycopg3 %s placeholders) — no string-built SQL.
Secrets: DATABASE_URL only ever read from env / gitignored config file; it is
never printed (redact_dsn for any log line that must mention the target).
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Sequence

import psycopg

from . import StoreError
from .statements import (
    _FINISH_RUN,
    _INSERT_LISTING,
    _INSERT_SNAPSHOT,
    _MARK_STALE,
    _RECORD_FAILURE,
    _START_RUN,
    STALE_RUNS,
)

# --- DSN constants, redaction, resolution ------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_ENV_FILE = _REPO_ROOT / "config" / "database.local.env"
_SCHEMA_PATH = _REPO_ROOT / "sql" / "schema.sql"

_DSN_RE = re.compile(r"(\w+://[^:/\s]+):[^@\s]+@")


def redact_dsn(dsn: str) -> str:
    """scheme://user:***@host/db — password never appears in output.
    Verified by: test_redact_dsn_strips_password"""
    return _DSN_RE.sub(r"\1:***@", dsn)


def get_database_url() -> str:
    """env DATABASE_URL wins; else gitignored config/database.local.env."""
    from dotenv import load_dotenv  # deferred: keeps import cost off --help paths

    if _DEFAULT_ENV_FILE.is_file():
        load_dotenv(_DEFAULT_ENV_FILE, override=False)  # never overrides real env
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise StoreError(
            "DATABASE_URL is not set.\n"
            "  Provide it via the environment or config/database.local.env "
            "(gitignored).\n"
            "  Format (see config/database.env.example):\n"
            "    DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
        )
    return url


# --- connection + schema -----------------------------------------------------


def connect(dsn: str) -> psycopg.Connection:
    try:
        return psycopg.connect(dsn)
    except psycopg.OperationalError as exc:
        raise StoreError(f"cannot connect to database {redact_dsn(dsn)}: {exc}") from exc


def apply_schema(conn: psycopg.Connection, schema_path: Path = _SCHEMA_PATH) -> None:
    if not schema_path.is_file():
        raise StoreError(f"schema file not found: {schema_path}")
    sql = schema_path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)  # multi-statement DDL, no params -> simple query protocol


# --- idempotent upserts ------------------------------------------------------


def upsert_listings(conn: psycopg.Connection, rows: Sequence[tuple]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(_INSERT_LISTING, rows)
    return len(rows)


def upsert_snapshots(conn: psycopg.Connection, rows: Sequence[tuple]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(_INSERT_SNAPSHOT, rows)
    return len(rows)


# --- pipeline_runs bookkeeping -----------------------------------------------


def start_pipeline_run(conn: psycopg.Connection, run_id: str, source: str | None) -> None:
    """Exactly one pipeline_runs row per run; a same-id re-run resets it.
    Verified by: test_upsert_semantics_sql_matches_contract"""
    with conn.cursor() as cur:
        cur.execute(_START_RUN, (run_id, source))


def finish_pipeline_run(
    conn: psycopg.Connection,
    run_id: str,
    status: str,
    records_scraped: int | None,
    records_loaded: int | None,
    notes: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(_FINISH_RUN, (status, records_scraped, records_loaded, notes, run_id))


def record_failed_run(
    conn: psycopg.Connection,
    run_id: str,
    *,
    source: str | None = None,
    note: str | None = None,
    started_at: datetime | None = None,
) -> None:
    """Make one failed run VISIBLE in pipeline_runs (see ``_RECORD_FAILURE``).

    Safe to call at any time for any run_id: it inserts a `failed` row when the
    run never reached stage 3, closes a row left `running` by a crash, and is a
    no-op on a row stage 3 already finished — so the orchestrator can call it
    after a failed stage without ever clobbering a more precise note.
    Verified by: test_record_failure_sql_never_overwrites_a_terminal_run
    """
    with conn.cursor() as cur:
        cur.execute(
            _RECORD_FAILURE,
            (run_id, started_at, source, redact_dsn(note) if note else None),
        )


# --- stale-listing marking ---------------------------------------------------


def mark_stale_listings(conn: psycopg.Connection, miss_runs: int = STALE_RUNS) -> int:
    """Flag listings not seen in the last `miss_runs` successful runs.

    Returns the number of listings flipped from active to inactive. Only rows
    that are still active and whose last_seen_at predates the cut-off change, so
    the statement is idempotent and returns 0 once everything is settled.

    Returns 0 without touching anything while fewer than `miss_runs` successful
    runs exist — see the cold-start note on `_MARK_STALE`. Callers must run this
    AFTER the current run has been marked successful, so that run counts towards
    the window.
    """
    with conn.cursor() as cur:
        cur.execute(_MARK_STALE, (miss_runs, miss_runs))
        return cur.rowcount


__all__ = [
    "apply_schema",
    "connect",
    "finish_pipeline_run",
    "get_database_url",
    "mark_stale_listings",
    "record_failed_run",
    "redact_dsn",
    "start_pipeline_run",
    "upsert_listings",
    "upsert_snapshots",
]
