#!/usr/bin/env python
"""WHAT:      Tier-1 migration verification executed against a real, ephemeral
           PostgreSQL — checks A-G: A apply order, B idempotency, C upgrade
           guard (the pipeline-breaking hazard), D grant hazard H1, E
           cold-start stale gate, F vw_listing_history + the shipped
           LISTING_HISTORY_QUERY, G the 1.1 recency guard.
WHY:       docs/apply_tier1_migration.md tells the owner to run SQL against
           production in a specific order, but nothing had OBSERVED the DDL
           outcome; every claim below is executed, not reasoned about. Run it
           through scripts/tier1_migration_check.ps1, which boots an ephemeral
           local cluster (initdb -A trust, 127.0.0.1 only) and passes
           DATABASE_URL. It creates and drops only its own `tier1_*` databases,
           never contacts production, and needs no credentials.
INPUTS:    DATABASE_URL env (ephemeral admin DSN); sql/schema.sql,
           sql/migrations/2026-10-16_tier1_is_active.sql, dashboard/views.sql,
           sql/vercel_readonly_role.sql, site/lib/db/queries.ts; the shipped
           code path src.store.{db,mapping}.
OUTPUTS:   PASS/FAIL line per check + a SUMMARY; exit 0 = every assertion
           passed, 1 = at least one failed.
CALLERS:   scripts/tier1_migration_check.ps1 (Windows-only bootstrapper).
TESTED BY: none (needs a live PostgreSQL) — the printed A0-G4 checks ARE the
           verification; the SQL text is also pinned by
           tests/test_schema_sqlglot.py and tests/test_store_stale.py.
"""
# D1 exemption (user call, 2026-10-22, REFACTOR_PLAN.md §4): kept whole at 459 ln — splitting this repo-only real-DB verification (unrunnable here: no Windows/Postgres) would trade a known size for an unverifiable refactor; rationale in docs/decisions.md §10.

from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.store import db as store_db  # noqa: E402  (the shipped code path)
from src.store.mapping import LISTING_COLUMNS, SNAPSHOT_COLUMNS  # noqa: E402

ADMIN_DSN = os.environ.get("DATABASE_URL", "")
if not ADMIN_DSN:
    print("FATAL: DATABASE_URL is not set - run via scripts/tier1_migration_check.ps1")
    raise SystemExit(2)

SCHEMA = REPO / "sql" / "schema.sql"
MIGRATION = REPO / "sql" / "migrations" / "2026-10-16_tier1_is_active.sql"
VIEWS = REPO / "dashboard" / "views.sql"
ROLE_SQL = REPO / "sql" / "vercel_readonly_role.sql"
DB_TS = REPO / "site" / "lib" / "db" / "queries.ts"  # moved out of lib/db.ts by the Phase 3 split

DB_ORDER = "tier1_order"
DB_UPGRADE = "tier1_upgrade"
DB_STALE = "tier1_stale"

VIEW_NAMES = ["vw_latest_listings", "vw_listing_history", "vw_zip_price_drop_30d"]
READ_OBJECTS = ["vw_latest_listings", "vw_zip_price_drop_30d", "vw_listing_history", "pipeline_runs"]
HISTORY_COLUMNS = [
    "source", "listing_id", "snapshot_date", "price", "previous_price", "price_reduced",
    "days_on_market", "price_per_sqft", "price_drop_pct", "motivation_score",
    "motivation_reason", "scraped_at",
]

passes = 0
failures = 0


def check(cond, label, expected="", actual="") -> None:
    global passes, failures
    if cond:
        passes += 1
        print(f"  PASS  {label}")
    else:
        failures += 1
        print(f"  FAIL  {label}  [expected: {expected}] [actual: {actual}]")


def section(title: str) -> None:
    print(f"\n== {title} ==")


# --- connection / DDL helpers ---
def dsn_for(database: str) -> str:
    u = urlsplit(ADMIN_DSN)
    return urlunsplit((u.scheme, u.netloc, "/" + database, u.query, u.fragment))


def q(database: str, sql: str, params=None) -> list[tuple]:
    with psycopg.connect(dsn_for(database), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else []


def scalar(database: str, sql: str, params=None):
    rows = q(database, sql, params)
    return rows[0][0] if rows else None


def fresh_db(name: str) -> None:
    with psycopg.connect(dsn_for("postgres"), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')


def apply_sql(database: str, sql: str) -> tuple[bool, str]:
    """Apply a multi-statement SQL text the way the runbook does.

    No params -> psycopg uses the simple query protocol (same path as
    sql/schema.sql in production), and Postgres treats the whole text as one
    transaction, so a failure leaves nothing behind.
    """
    try:
        with psycopg.connect(dsn_for(database), autocommit=True) as conn:
            conn.execute(sql)
        return True, ""
    except psycopg.Error as exc:
        return False, str(exc).splitlines()[0].strip()


def apply_file(database: str, path: Path) -> tuple[bool, str]:
    return apply_sql(database, path.read_text(encoding="utf-8"))


def columns(database: str, relation: str) -> list[str]:
    return [
        r[0]
        for r in q(
            database,
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = %s
               ORDER BY ordinal_position""",
            (relation,),
        )
    ]


def has_column(database: str, relation: str, column: str) -> bool:
    return column in columns(database, relation)


def view_names(database: str) -> list[str]:
    return [r[0] for r in q(database, "SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname")]


def head_schema_text() -> str:
    """The committed (pre-Tier-1) schema - how production looks today."""
    cp = subprocess.run(["git", "show", "HEAD:sql/schema.sql"], cwd=REPO, capture_output=True, text=True)
    return cp.stdout if cp.returncode == 0 else ""


def listing_row(listing_id: str, **over) -> tuple:
    vals = {
        "source": "zillow",
        "listing_id": listing_id,
        "address": f"{listing_id} TEST ST",
        "city": "Brooklyn",
        "state": "NY",
        "zip": "11215",
        "latitude": 40.6,
        "longitude": -73.9,
        "property_type": "house",
        "bedrooms": 3,
        "bathrooms": 2,
        "living_area_sqft": 1500,
        "url": f"https://example.test/{listing_id}",
    }
    vals.update(over)
    return tuple(vals[c] for c in LISTING_COLUMNS)


def upsert_listing(database: str, listing_id: str, **over) -> None:
    with psycopg.connect(dsn_for(database)) as conn:
        store_db.upsert_listings(conn, [listing_row(listing_id, **over)])
        conn.commit()


# --- A / B - apply order and idempotency (on a pre-Tier-1 database) ---
section("A. apply order - views.sql before the migration must fail")
fresh_db(DB_ORDER)
head = head_schema_text()
check(
    bool(head) and "is_active" not in head,
    "A0 git HEAD:sql/schema.sql is the pre-Tier-1 shape (no is_active)",
    "no is_active",
    "empty" if not head else "contains is_active",
)
ok, err = apply_sql(DB_ORDER, head)
check(ok, "A1 the pre-Tier-1 schema applies", "ok", err)
check(not has_column(DB_ORDER, "listings", "is_active"), "A2 baseline: no is_active column", "absent", "present")

ok, err = apply_file(DB_ORDER, VIEWS)
check(not ok, "A3 views.sql BEFORE the migration fails (so the runbook order is required)", "error", "succeeded")
check("is_active" in err, "A4 ...and the error names is_active (undefined column)", "names is_active", err)
check(view_names(DB_ORDER) == [], "A5 the failed apply left no views behind (rolled back)", "[]", str(view_names(DB_ORDER)))

ok, err = apply_file(DB_ORDER, MIGRATION)
check(ok, "A6 the migration applies", "ok", err)
ok, err = apply_file(DB_ORDER, VIEWS)
check(ok, "A7 views.sql after the migration applies", "ok", err)
check(view_names(DB_ORDER) == VIEW_NAMES, "A8 all three views exist", str(VIEW_NAMES), str(view_names(DB_ORDER)))

section("B. idempotency - every file re-applies cleanly and changes no schema")
before_view_cols = {v: columns(DB_ORDER, v) for v in VIEW_NAMES}
before_listing_cols = columns(DB_ORDER, "listings")
ok1, e1 = apply_file(DB_ORDER, MIGRATION)
ok2, e2 = apply_file(DB_ORDER, VIEWS)
ok3, e3 = apply_file(DB_ORDER, SCHEMA)
check(ok1 and ok2 and ok3, "B1 migration + views + schema each re-apply cleanly", "all ok", f"{ok1}/{ok2}/{ok3} | {e1}{e2}{e3}")
check(view_names(DB_ORDER) == VIEW_NAMES, "B2 the view set is unchanged after re-apply", str(VIEW_NAMES), str(view_names(DB_ORDER)))
after_view_cols = {v: columns(DB_ORDER, v) for v in view_names(DB_ORDER)}
check(after_view_cols == before_view_cols, "B3 every view keeps its exact column list and order", "identical", str(after_view_cols))
check(columns(DB_ORDER, "listings") == before_listing_cols, "B4 listings keeps its exact column list and order", "identical", str(columns(DB_ORDER, "listings")))
check(scalar(DB_ORDER, "SELECT count(*) FROM listings") == 0, "B5 re-apply created no rows", "0", str(scalar(DB_ORDER, "SELECT count(*) FROM listings")))
check(
    columns(DB_ORDER, "vw_latest_listings")[-2:] == ["is_active", "last_seen_at"],
    "B6 the new columns are appended LAST (Power BI / dashboard column order preserved)",
    "['is_active', 'last_seen_at']",
    str(columns(DB_ORDER, "vw_latest_listings")[-2:]),
)

# --- C - the is_active upgrade guard (the pipeline-breaking hazard) ---
section("C. upgrade guard - a pre-Tier-1 database rejects the loader's upsert until repaired")
fresh_db(DB_UPGRADE)
ok, err = apply_sql(DB_UPGRADE, head)
check(ok, "C1 the pre-Tier-1 schema applies", "ok", err)
check(not has_column(DB_UPGRADE, "listings", "is_active"), "C2 baseline: no is_active column", "absent", "present")

failure = ""
try:
    upsert_listing(DB_UPGRADE, "C1")
except psycopg.Error as exc:
    failure = str(exc).splitlines()[0].strip()
check(bool(failure), "C3 the loader's REAL upsert FAILS on the pre-Tier-1 database", "UndefinedColumn 42703", "succeeded")
check("is_active" in failure, "C4 ...and the failure names is_active (the exact production break)", "names is_active", failure or "(no error)")

ok, err = apply_file(DB_UPGRADE, SCHEMA)
check(ok, "C5 sql/schema.sql applies on the pre-Tier-1 database", "ok", err)
check(has_column(DB_UPGRADE, "listings", "is_active"), "C6 ...and the upgrade guard repaired the column", "present", "absent")

try:
    upsert_listing(DB_UPGRADE, "C1")
    failure = ""
except psycopg.Error as exc:
    failure = str(exc).splitlines()[0].strip()
check(not failure, "C7 the SAME upsert now succeeds", "ok", failure)
check(scalar(DB_UPGRADE, "SELECT count(*) FROM listings") == 1, "C8 ...and writes exactly one row", "1", str(scalar(DB_UPGRADE, "SELECT count(*) FROM listings")))
check(scalar(DB_UPGRADE, "SELECT is_active FROM listings WHERE listing_id='C1'") is True, "C9 the written row is active", "True", str(scalar(DB_UPGRADE, "SELECT is_active FROM listings WHERE listing_id='C1'")))

upsert_listing(DB_UPGRADE, "C1", address="999 UPDATED AVE")
check(scalar(DB_UPGRADE, "SELECT address FROM listings WHERE listing_id='C1'") == "999 UPDATED AVE", "C10 a re-upsert takes the ON CONFLICT DO UPDATE branch", "999 UPDATED AVE", str(scalar(DB_UPGRADE, "SELECT address FROM listings WHERE listing_id='C1'")))
check(scalar(DB_UPGRADE, "SELECT is_active FROM listings WHERE listing_id='C1'") is True, "C11 ...and still sets is_active = true", "True", str(scalar(DB_UPGRADE, "SELECT is_active FROM listings WHERE listing_id='C1'")))

# --- D - the grant hazard (H1) and the runbook's fix ---
section("D. grant hazard H1 - re-applying views.sql destroys the reader's SELECT")
role = f"tier1_reader_{os.getpid()}"
with psycopg.connect(dsn_for(DB_ORDER), autocommit=True) as conn:
    conn.execute(f'CREATE ROLE "{role}" LOGIN')
    conn.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')
    conn.execute(f'GRANT SELECT ON {", ".join(READ_OBJECTS)} TO "{role}"')


def as_role(sql: str) -> tuple[bool, str]:
    try:
        with psycopg.connect(dsn_for(DB_ORDER), autocommit=True) as conn:
            conn.execute(f'SET ROLE "{role}"')
            conn.execute(sql)
        return True, ""
    except psycopg.Error as exc:
        return False, str(exc).splitlines()[0].strip()


check(
    all(o in ROLE_SQL.read_text(encoding="utf-8") for o in READ_OBJECTS),
    "D1 sql/vercel_readonly_role.sql grants all four objects the site reads",
    "all four",
    "missing one",
)
for obj in READ_OBJECTS:
    ok, err = as_role(f"SELECT count(*) FROM {obj}")
    check(ok, f"D2 reader can SELECT {obj}", "ok", err)
for base in ["listings", "listing_snapshots"]:
    ok, err = as_role(f"SELECT count(*) FROM {base}")
    check(not ok and "permission denied" in err.lower(), f"D3 reader cannot SELECT {base} (least privilege kept)", "permission denied", err or "readable")

ok, err = apply_file(DB_ORDER, VIEWS)  # the runbook's step 2
check(ok, "D4 views.sql re-applies", "ok", err)
for obj in ["vw_latest_listings", "vw_zip_price_drop_30d"]:
    ok, err = as_role(f"SELECT count(*) FROM {obj}")
    check(not ok, f"D5 H1 REPRODUCED: the reader LOST SELECT on {obj} after the re-apply", "permission denied", "still readable")
ok, err = as_role(f"SELECT count(*) FROM vw_listing_history")
check(not ok, "D6 the recreated vw_listing_history is unreadable too until granted", "permission denied", "readable")
ok, err = as_role("SELECT count(*) FROM pipeline_runs")
check(ok, "D7 pipeline_runs keeps its grant (it is not dropped - only the views are)", "ok", err)

with psycopg.connect(dsn_for(DB_ORDER), autocommit=True) as conn:
    conn.execute(f'GRANT SELECT ON {", ".join(READ_OBJECTS)} TO "{role}"')
restored = [as_role(f"SELECT count(*) FROM {o}")[0] for o in READ_OBJECTS]
check(all(restored), "D8 the runbook's four-object re-grant restores every read", "all readable", str(restored))
try:  # cleanup is best-effort: never let it hide a real assertion result
    with psycopg.connect(dsn_for(DB_ORDER), autocommit=True) as conn:
        conn.execute(f'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "{role}"')
        conn.execute(f'REVOKE USAGE ON SCHEMA public FROM "{role}"')
        conn.execute(f'DROP ROLE "{role}"')
except psycopg.Error as exc:
    print(f"  note  could not drop role {role}: {str(exc).splitlines()[0].strip()}")

# --- E / F / G - stale marking, price history, recency guard ---
section("E. cold-start gate - the real mark_stale_listings() below STALE_RUNS successful runs")
fresh_db(DB_STALE)
ok, err = apply_file(DB_STALE, SCHEMA)
check(ok, "E0 schema applies", "ok", err)

T = datetime.now(timezone.utc).replace(microsecond=0)
for lid in ["L_new", "L_recent", "L_gone", "L_dead"]:
    upsert_listing(DB_STALE, lid)
seen = {  # explicit freshness, independent of when this script runs
    "L_new": T - timedelta(hours=1),
    "L_recent": T - timedelta(days=2, hours=12),
    "L_gone": T - timedelta(days=5),
    "L_dead": T - timedelta(days=10),
}
with psycopg.connect(dsn_for(DB_STALE), autocommit=True) as conn:
    for lid, ts in seen.items():
        conn.execute("UPDATE listings SET last_seen_at = %s WHERE listing_id = %s", (ts, lid))

RUNS = [  # newest first
    ("r4", T - timedelta(days=1)),
    ("r3", T - timedelta(days=2)),
    ("r2", T - timedelta(days=3)),
    ("r1", T - timedelta(days=4)),
]


def add_run(run_id: str, started: datetime) -> None:
    with psycopg.connect(dsn_for(DB_STALE), autocommit=True) as conn:
        conn.execute(
            """INSERT INTO pipeline_runs (run_id, started_at, finished_at, status, source, records_loaded)
               VALUES (%s, %s, %s, 'success', 'zillow', 1)""",
            (run_id, started, started + timedelta(minutes=20)),
        )


def mark(miss_runs: int = store_db.STALE_RUNS) -> int:
    with psycopg.connect(dsn_for(DB_STALE)) as conn:
        n = store_db.mark_stale_listings(conn, miss_runs)
        conn.commit()
        return n


def inactive() -> list[str]:
    return [r[0] for r in q(DB_STALE, "SELECT listing_id FROM listings WHERE NOT is_active ORDER BY listing_id")]


def active_count() -> int:
    return int(scalar(DB_STALE, "SELECT count(*) FROM listings WHERE is_active"))


for label, run in (
    ("E1 0 successful runs", None),
    ("E2 1 successful run (< STALE_RUNS)", RUNS[0]),
    ("E3 2 successful runs (< STALE_RUNS)", RUNS[1]),
):
    if run:
        add_run(*run)
    changed = mark()
    check(
        changed == 0 and active_count() == 4,
        f"{label}: a true no-op, no listing is deactivated",
        "0 changed / 4 active",
        f"{changed} changed / {active_count()} active",
    )

add_run(*RUNS[2])  # r2 closes the 3-run window: cut-off = r2.started_at = T-3d. Verified by: checks E4/E5 (this script).
n = mark()
check(n == 2, "E4 3 successful runs: exactly the two listings that missed all three are deactivated", "2", str(n))
check(inactive() == ["L_dead", "L_gone"], "E5 ...and they are the right ones (L_recent missed 2, so it stays)", "['L_dead', 'L_gone']", str(inactive()))
check(mark() == 0, "E6 re-running is idempotent", "0", str(mark()))

add_run(*RUNS[3])  # an older 4th run must not change the window. Verified by: check E7 (this script).
check(mark() == 0, "E7 an older 4th run does not change the outcome (window = the newest N)", "0", str(mark()))

upsert_listing(DB_STALE, "L_gone", address="1 BACK ON MARKET BLVD")
check(scalar(DB_STALE, "SELECT is_active FROM listings WHERE listing_id='L_gone'") is True, "E8 a listing that reappears is reactivated by the upsert", "True", str(scalar(DB_STALE, "SELECT is_active FROM listings WHERE listing_id='L_gone'")))

section("F. 1.2 - the shipped LISTING_HISTORY_QUERY against the real view")
ok, err = apply_file(DB_STALE, VIEWS)
check(ok, "F0 views apply", "ok", err)

snaps = [
    ("zillow", "L_new", (T - timedelta(days=3)).date(), 500000, None, None, 30, 500.00, None, "Low", "listed", T - timedelta(days=3)),
    ("zillow", "L_new", (T - timedelta(days=2)).date(), 480000, 500000, True, 31, 480.00, 4.00, "Medium", "first reduction", T - timedelta(days=2)),
    ("zillow", "L_new", (T - timedelta(days=1)).date(), 470000, 480000, True, 32, 470.00, 6.00, "High", "second reduction", T - timedelta(days=1)),
]
with psycopg.connect(dsn_for(DB_STALE)) as conn:
    store_db.upsert_snapshots(conn, [tuple(s) for s in snaps])
    conn.commit()

check(columns(DB_STALE, "vw_listing_history") == HISTORY_COLUMNS, "F1 vw_listing_history exposes exactly the contract column set", str(HISTORY_COLUMNS), str(columns(DB_STALE, "vw_listing_history")))

ts = DB_TS.read_text(encoding="utf-8")
m = re.search(r"export const LISTING_HISTORY_QUERY = `(.*?)`;", ts, re.S)
check(m is not None, "F2 LISTING_HISTORY_QUERY found in site/lib/db/queries.ts", "match", "not found")
history_sql, names, rows = "", [], []
if m:
    history_sql = m.group(1).replace("$1", "'zillow'").replace("$2", "'L_new'")
    try:
        with psycopg.connect(dsn_for(DB_STALE), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(history_sql)
                names = [d.name for d in cur.description]
                rows = cur.fetchall()
    except psycopg.Error as exc:
        names = [f"ERROR: {str(exc).splitlines()[0].strip()}"]
check(rows and len(rows) == 3, "F3 the shipped query returns the full 3-row history", "3 rows", f"{len(rows)} rows")
check(names == HISTORY_COLUMNS, "F4 its result columns match the SELECT list / lib/api-types.ts exactly", str(HISTORY_COLUMNS), str(names))
if rows:
    dates = [r[names.index("snapshot_date")] for r in rows]
    check(dates == sorted(dates), "F5 history comes back oldest-first (the sparkline needs no re-sort)", "ascending", str(dates))
    priced = [r for r in rows if r[names.index("price_reduced")] is True]
    check(len(priced) == 2, "F6 both recorded reductions survive the view", "2", str(len(priced)))
    check(all(r[names.index("price")] < r[names.index("previous_price")] for r in priced), "F7 every reduction has price < previous_price", "all", "some")
else:
    check(False, "F5-F7 skipped: the query did not run", "rows", names)

section("G. 1.1 - the recency guard on two snapshot dates")
upsert_listing(DB_STALE, "L_old")
with psycopg.connect(dsn_for(DB_STALE)) as conn:
    store_db.upsert_snapshots(
        conn,
        [
            ("zillow", "L_recent", (T - timedelta(days=1)).date(), 600000, None, None, 10, 600.00, None, "Medium", "fresh", T - timedelta(days=1)),
            ("zillow", "L_old", (T - timedelta(days=2)).date(), 700000, None, None, 90, 700.00, None, "Low", "not resighted", T - timedelta(days=2)),
        ],
    )
    conn.commit()

NEWEST = "(SELECT max(snapshot_date) FROM vw_latest_listings)"
cohort = int(scalar(DB_STALE, f"SELECT count(*) FROM vw_latest_listings WHERE snapshot_date = {NEWEST}"))
total = int(scalar(DB_STALE, "SELECT count(*) FROM vw_latest_listings"))
window1 = int(scalar(DB_STALE, f"SELECT count(*) FROM vw_latest_listings WHERE snapshot_date >= {NEWEST} - 1"))
check(cohort < total, "G1 the guard excludes at least one stale row (cohort < whole view)", "< total", f"{cohort} of {total}")
stale_ids = [
    r[0]
    for r in q(DB_STALE, f"SELECT listing_id FROM vw_latest_listings WHERE snapshot_date <> {NEWEST} ORDER BY listing_id")
]
check(stale_ids == ["L_old"], "G2 the excluded rows are exactly those whose NEWEST snapshot is older", "['L_old']", str(stale_ids))
check(window1 > cohort, "G3 window_days >= 1 keeps the stale row (the dial loosens the guard)", f"> {cohort}", str(window1))
with psycopg.connect(dsn_for(DB_STALE), autocommit=True) as conn:
    conn.execute("DELETE FROM listing_snapshots WHERE snapshot_date = (SELECT max(snapshot_date) FROM listing_snapshots)")
cohort_after = int(scalar(DB_STALE, f"SELECT count(*) FROM vw_latest_listings WHERE snapshot_date = {NEWEST}"))
check(cohort_after > 0, "G4 after a MISSED run the guard still returns the newest available cohort, never an empty map", "> 0", str(cohort_after))

print(f"\n== SUMMARY ==\npassed: {passes}   failed: {failures}   total: {passes + failures}")
print("RESULT: " + ("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED"))
raise SystemExit(0 if failures == 0 else 1)
