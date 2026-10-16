"""Schema validation: contract DDL parses as Postgres (sqlglot) and is idempotent."""

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
