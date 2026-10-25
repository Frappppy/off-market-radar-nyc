"""WHAT:      Schema-shape guards for sql/schema.sql, the tier-1 migration and
           dashboard/views.sql: Postgres parse, idempotency, required
           indexes/keys, the is_active upgrade guard, upsert SQL shape.
WHY:       The store stage applies schema.sql on EVERY run; a broken or
           non-idempotent statement takes the scheduled load down, so the DDL
           text is asserted directly — no live database needed.
INPUTS:    sql/schema.sql, sql/migrations/2026-10-16_tier1_is_active.sql,
           dashboard/views.sql, src.store.db statement constants.
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
"""

from pathlib import Path

import sqlglot

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "sql" / "schema.sql"
MIGRATION = ROOT / "sql" / "migrations" / "2026-10-16_tier1_is_active.sql"
VIEWS = ROOT / "dashboard" / "views.sql"


def test_schema_parses_as_postgres():
    statements = sqlglot.parse(SCHEMA.read_text(encoding="utf-8"), dialect="postgres")
    assert statements, "schema.sql parsed to zero statements"


def test_schema_has_contract_tables():
    statements = sqlglot.parse(SCHEMA.read_text(encoding="utf-8"), dialect="postgres")
    creates = " ".join(
        s.sql(dialect="postgres").upper()
        for s in statements
        if s is not None and s.key == "create"
    )
    for table in ("LISTINGS", "LISTING_SNAPSHOTS", "PIPELINE_RUNS"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in creates


def test_schema_is_idempotent_and_indexed():
    text = SCHEMA.read_text(encoding="utf-8")
    for table in ("listings", "listing_snapshots", "pipeline_runs"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in text
    assert "IF NOT EXISTS idx_listing_snapshots_snapshot_date" in text
    assert "ON listing_snapshots (snapshot_date)" in text
    assert "IF NOT EXISTS idx_listings_zip" in text
    assert "ON listings (zip)" in text
    assert "PRIMARY KEY (source, listing_id)" in text
    assert "UNIQUE (source, listing_id, snapshot_date)" in text


def test_upsert_semantics_sql_matches_contract():
    from src.store import db

    assert "ON CONFLICT (source, listing_id) DO UPDATE" in db._INSERT_LISTING
    assert "last_seen_at     = now()" in db._INSERT_LISTING
    assert "first_seen_at" not in db._INSERT_LISTING.split("DO UPDATE", 1)[1]
    assert "ON CONFLICT (source, listing_id, snapshot_date) DO UPDATE" in db._INSERT_SNAPSHOT
    assert "ON CONFLICT (run_id) DO UPDATE" in db._START_RUN
    assert "'running'" in db._START_RUN


def test_record_failure_sql_never_overwrites_a_terminal_run():
    """The orchestrator's failure channel must be safe to call any time.

    `--record-failure` runs after ANY failed stage, including stage 3 itself,
    so the statement has to insert a row when none exists, close a row left
    `running`, and change NOTHING about a row already `success`/`failed` —
    otherwise a month of runs would be re-labelled, or a successful run turned
    into a failure.
    """
    import sqlglot

    from src.store import db

    sql = db._RECORD_FAILURE
    assert "INSERT INTO pipeline_runs" in sql
    assert "ON CONFLICT (run_id) DO UPDATE" in sql
    assert "'failed'" in sql
    # only a row still marked 'running' may be flipped by the recorder
    assert "CASE WHEN pipeline_runs.status = 'running'" in sql
    assert "ELSE pipeline_runs.status END" in sql
    # an existing note (stage 3's own, more precise one) wins
    assert "COALESCE(pipeline_runs.notes, EXCLUDED.notes)" in sql
    assert "COALESCE(pipeline_runs.finished_at, now())" in sql
    # 4 placeholders: run_id, started_at, source, notes
    assert sql.count("%s") == 4
    assert sqlglot.parse_one(sql, dialect="postgres") is not None


def test_schema_declares_is_active_column():
    text = SCHEMA.read_text(encoding="utf-8")
    # Column-aligned DDL: compare with whitespace collapsed.
    flat = " ".join(text.split())
    assert "is_active boolean NOT NULL DEFAULT true" in flat
    # ...and it belongs to the listings table, after last_seen_at.
    listings_ddl = text.split("CREATE TABLE IF NOT EXISTS listings", 1)[1].split(");", 1)[0]
    assert "is_active" in listings_ddl
    assert listings_ddl.index("last_seen_at") < listings_ddl.index("is_active")


def test_schema_carries_the_is_active_upgrade_guard():
    """Guard against a pipeline-breaking regression.

    `CREATE TABLE IF NOT EXISTS` is a no-op on an existing database, so the
    column can only reach a pre-existing `listings` table via this idempotent
    ALTER — which the store stage applies on every run. Removing it (or moving it
    out of schema.sql) makes the next scheduled load fail outright, because the
    upsert sets `is_active = true`.
    """
    text = SCHEMA.read_text(encoding="utf-8")
    flat = " ".join(text.split())
    assert "ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;" in flat
    # it must come after the table it alters, or the file would not parse
    assert flat.index("CREATE TABLE IF NOT EXISTS listings") < flat.index("ALTER TABLE listings")


def test_migration_parses_as_postgres_and_adds_is_active():
    text = MIGRATION.read_text(encoding="utf-8")
    statements = sqlglot.parse(text, dialect="postgres")
    assert statements, "migration parsed to zero statements"
    assert "ADD COLUMN IF NOT EXISTS is_active" in text
    assert "BEGIN;" in text and "COMMIT;" in text


def test_views_expose_is_active_and_listing_history():
    text = VIEWS.read_text(encoding="utf-8")
    assert "DROP VIEW IF EXISTS vw_listing_history CASCADE;" in text
    assert "CREATE OR REPLACE VIEW vw_listing_history AS" in text
    # Scope to the vw_latest_listings definition only (up to the next view).
    latest = text.split("CREATE OR REPLACE VIEW vw_latest_listings AS", 1)[1]
    latest = latest.split("CREATE OR REPLACE VIEW", 1)[0]
    assert "l.is_active" in latest
    assert "l.last_seen_at" in latest
