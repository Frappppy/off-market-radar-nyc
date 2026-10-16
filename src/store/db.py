"""Postgres access: connection, idempotent upserts, pipeline_runs bookkeeping,
and stale-listing (is_active) marking.

All queries are parameterized (psycopg3 %s placeholders) — no string-built SQL.
Secrets: DATABASE_URL only ever read from env / gitignored config file; it is
never printed (redact_dsn for any log line that must mention the target).
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Sequence

import psycopg

from . import StoreError
from .mapping import LISTING_COLUMNS, SNAPSHOT_COLUMNS

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_ENV_FILE = _REPO_ROOT / "config" / "database.local.env"
_SCHEMA_PATH = _REPO_ROOT / "sql" / "schema.sql"

_INSERT_LISTING = f"""
INSERT INTO listings ({', '.join(LISTING_COLUMNS)})
VALUES ({', '.join(['%s'] * len(LISTING_COLUMNS))})
ON CONFLICT (source, listing_id) DO UPDATE SET
  address          = EXCLUDED.address,
  city             = EXCLUDED.city,
  state            = EXCLUDED.state,
  zip              = EXCLUDED.zip,
  latitude         = EXCLUDED.latitude,
  longitude        = EXCLUDED.longitude,
  property_type    = EXCLUDED.property_type,
  bedrooms         = EXCLUDED.bedrooms,
  bathrooms        = EXCLUDED.bathrooms,
  living_area_sqft = EXCLUDED.living_area_sqft,
  url              = EXCLUDED.url,
  is_active        = true,
  last_seen_at     = now()
"""

_INSERT_SNAPSHOT = f"""
INSERT INTO listing_snapshots ({', '.join(SNAPSHOT_COLUMNS)})
VALUES ({', '.join(['%s'] * len(SNAPSHOT_COLUMNS))})
ON CONFLICT (source, listing_id, snapshot_date) DO UPDATE SET
  price             = EXCLUDED.price,
  previous_price    = EXCLUDED.previous_price,
  price_reduced     = EXCLUDED.price_reduced,
  days_on_market    = EXCLUDED.days_on_market,
  price_per_sqft    = EXCLUDED.price_per_sqft,
  price_drop_pct    = EXCLUDED.price_drop_pct,
  motivation_score  = EXCLUDED.motivation_score,
  motivation_reason = EXCLUDED.motivation_reason,
  scraped_at        = EXCLUDED.scraped_at
"""

_START_RUN = """
INSERT INTO pipeline_runs (run_id, started_at, status, source)
VALUES (%s, now(), 'running', %s)
ON CONFLICT (run_id) DO UPDATE SET
  started_at      = now(),
  finished_at     = NULL,
  status          = 'running',
  records_scraped = NULL,
  records_loaded  = NULL,
  notes           = NULL
"""

_FINISH_RUN = """
UPDATE pipeline_runs
SET finished_at = now(), status = %s, records_scraped = %s,
    records_loaded = %s, notes = %s
WHERE run_id = %s
"""

# A listing is deactivated after missing this many consecutive successful runs
# (it has not appeared in the feed for that many runs: sold / delisted / pulled).
STALE_RUNS = 3

# Cut-off = the started_at of the N-th most recent successful run. A listing
# whose last_seen_at predates that has missed N complete successful loads.
#
# The `count(*) >= N` gate is load-bearing, not decorative: it makes the whole
# statement a NO-OP until N successful runs exist. Without it, a freshly-seeded
# database (fewer than N runs) collapses the cut-off onto the most recent run —
# so a listing merely absent from today's feed, or one skipped because that run
# was partial, would be deactivated after a SINGLE miss instead of N. With too
# little history there is no honest way to tell "gone" from "not scraped this
# time", so the conservative choice is to do nothing.
#
# With the gate passed the subquery always yields N rows, so MIN() cannot be
# NULL; and if it ever were, `last_seen_at < NULL` is NULL and updates nothing,
# so the NULL path is safe regardless of evaluation order.
# The `l.is_active` guard keeps the UPDATE idempotent and cheap on re-runs.
_MARK_STALE = """
UPDATE listings l
SET is_active = false
WHERE l.is_active
  AND (SELECT count(*) FROM pipeline_runs WHERE status = 'success') >= %s
  AND l.last_seen_at < (
        SELECT MIN(r.started_at)
          FROM (SELECT started_at
                  FROM pipeline_runs
                 WHERE status = 'success'
                   AND started_at IS NOT NULL
                 ORDER BY started_at DESC
                 LIMIT %s) AS r
      )
"""

_DSN_RE = re.compile(r"(\w+://[^:/\s]+):[^@\s]+@")


def redact_dsn(dsn: str) -> str:
    """scheme://user:***@host/db — password never appears in output."""
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


def start_pipeline_run(conn: psycopg.Connection, run_id: str, source: str | None) -> None:
    """Exactly one pipeline_runs row per run; a same-id re-run resets it."""
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


def count_rows(conn: psycopg.Connection, table: str) -> int:
    """Table name is internal-only (tests/verification); values never user input."""
    allowed = {"listings", "listing_snapshots", "pipeline_runs"}
    if table not in allowed:
        raise ValueError(f"unexpected table {table!r}")
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {table}")
        (n,) = cur.fetchone()
    return int(n)


__all__ = [
    "apply_schema",
    "connect",
    "count_rows",
    "finish_pipeline_run",
    "get_database_url",
    "mark_stale_listings",
    "redact_dsn",
    "start_pipeline_run",
    "upsert_listings",
    "upsert_snapshots",
]
