-- Project 1: The Off-Market Real Estate Deal Finder — Stage 3 schema
-- Source of truth: docs/data_contract.md § "Stage 3 — SQL".
-- DDL copied verbatim from the contract; only idempotency guards
-- (IF NOT EXISTS) and the required indexes were added.
-- Target: Postgres (Neon). No extensions.

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
  PRIMARY KEY (source, listing_id)
);

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
