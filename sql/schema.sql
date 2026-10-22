-- WHAT:      Stage 3 DDL — listings, listing_snapshots, pipeline_runs (+ the 2
--            required indexes), applied by the store stage on EVERY run.
-- WHY:       The executable half of the docs/data_contract.md DDL contract:
--            this file runs (src.store.db.apply_schema), the contract
--            documents it, and nothing else links the two copies — the parity
--            tests diff them. (Detailed rationale in the block below.)
-- INPUTS:    docs/data_contract.md § "Stage 3 — SQL" (source of truth).
-- OUTPUTS:   idempotent Postgres DDL on the target database (Neon).
-- CALLERS:   src.store.db.apply_schema (every load);
--            docs/apply_tier1_migration.md (manual application).
-- TESTED BY: tests/test_schema_sqlglot.py (test_schema_parses_as_postgres,
--            test_schema_is_idempotent_and_indexed,
--            test_schema_carries_the_is_active_upgrade_guard),
--            tests/test_contract_parity.py
--            (test_contract_stage3_ddl_matches_schema_sql — I13 parity).

-- Project 1: The Off-Market Real Estate Deal Finder — Stage 3 schema
-- Source of truth: docs/data_contract.md § "Stage 3 — SQL".
-- DDL copied verbatim from the contract; only idempotency guards
-- (IF NOT EXISTS), the upgrade guards noted below, and the required indexes
-- were added.
-- Target: Postgres (Neon). No extensions.
--
-- Applied automatically by the store stage on EVERY run (`apply_schema`), so
-- every statement here must be safe to re-run against a populated database.
-- That is why the is_active upgrade guard below lives in this file and not only
-- in sql/migrations/: CREATE TABLE IF NOT EXISTS is a no-op on an existing
-- database, so without it a load would fail on a table created before the
-- column existed. See docs/apply_tier1_migration.md.

CREATE TABLE IF NOT EXISTS listings (
  source            text NOT NULL,
  listing_id        text NOT NULL,
  address           text,
  city              text,
  state             text,
  zip               text,
  latitude          double precision,
  longitude         double precision,
  property_type     text,
  bedrooms          numeric,
  bathrooms         numeric,
  living_area_sqft  integer,
  url               text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  -- is_active: false = the listing missed N consecutive successful runs (sold /
  -- delisted / pulled) and must not be presented as live. A returning listing is
  -- set back to true by the loader's ON CONFLICT DO UPDATE.
  -- Deliberately NO index on this column: the table holds ~1k rows and the
  -- column is low-selectivity (two values), so a sequential scan is already the
  -- cheaper plan — an index would only add write cost for no read benefit.
  is_active         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (source, listing_id)
);

-- Upgrade guard — required, not decorative.
-- The statement above is a no-op on a database where `listings` already exists,
-- so a database created before this column has no way to acquire it from a
-- CREATE TABLE IF NOT EXISTS. The loader's upsert sets `is_active = true` on
-- every successful load, so without this guard the next scheduled run would
-- fail outright with `column "is_active" of relation "listings" does not exist`.
-- The identical statement is recorded (for humans and for applying by hand) in
-- sql/migrations/2026-10-16_tier1_is_active.sql.
-- On PostgreSQL 11+ this is metadata-only: the constant DEFAULT is stored in the
-- catalog, so no table rewrite and no per-row backfill happens.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS listing_snapshots (
  snapshot_id       bigserial PRIMARY KEY,
  source            text NOT NULL,
  listing_id        text NOT NULL,
  snapshot_date     date NOT NULL,
  price             integer,
  previous_price    integer,
  price_reduced     boolean,
  days_on_market    integer,
  price_per_sqft    numeric(10,2),
  price_drop_pct    numeric(6,2),
  motivation_score  text NOT NULL CHECK (motivation_score IN ('High','Medium','Low')),
  motivation_reason text,
  scraped_at        timestamptz NOT NULL,
  FOREIGN KEY (source, listing_id) REFERENCES listings (source, listing_id),
  UNIQUE (source, listing_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id           text PRIMARY KEY,
  started_at       timestamptz,
  finished_at      timestamptz,
  status           text,           -- running | success | failed
  source           text,
  records_scraped  integer,
  records_loaded   integer,
  notes            text
);

-- required indexes: listing_snapshots(snapshot_date),
-- listings(zip) (zip-joined via listings(zip) from the dashboard)
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_snapshot_date
  ON listing_snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_listings_zip
  ON listings (zip);
