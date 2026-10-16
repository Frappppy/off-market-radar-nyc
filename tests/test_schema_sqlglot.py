"""Schema validation: contract DDL parses as Postgres (sqlglot) and is idempotent."""

from pathlib import Path

import sqlglot

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "sql" / "schema.sql"


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
