-- =============================================================================
-- Project 1: The Off-Market Real Estate Deal Finder
-- Stage 4 (visualize / Power BI) -- dashboard views.
--
-- Owner: dashboard stage. Apply AFTER the Stage 3 tables exist
-- (sql/schema.sql per docs/data_contract.md). Safe to re-run (idempotent).
--
-- How to apply:
--   psql "$DATABASE_URL" -f dashboard/views.sql
--   ...or paste this whole file into the Neon console SQL editor and Run.
--
-- Idempotency note: PostgreSQL has NO "CREATE VIEW IF NOT EXISTS", so the
-- portable pattern is DROP VIEW IF EXISTS ... CASCADE + CREATE OR REPLACE VIEW.
-- Both statements run inside a transaction so a failure rolls the file back.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS vw_zip_price_drop_30d CASCADE;
DROP VIEW IF EXISTS vw_latest_listings CASCADE;
DROP VIEW IF EXISTS vw_listing_history CASCADE;

-- -----------------------------------------------------------------------------
-- vw_latest_listings -- one row per (source, listing_id): the listing's MOST
-- RECENT listing_snapshots row joined to the mutable listing attributes.
-- Drives the Power BI map, KPI cards and the detail table.
-- INNER JOIN is deliberate: a listing with no snapshot yet has no price /
-- motivation data and must not appear on the dashboard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_latest_listings AS
SELECT
    l.source,
    l.listing_id,
    l.address,
    l.city,
    l.zip,
    l.latitude,
    l.longitude,
    l.property_type,
    s.price,
    s.days_on_market,
    s.price_per_sqft,
    s.price_drop_pct,
    s.motivation_score,
    s.motivation_reason,
    s.snapshot_date,
    l.url,
    -- Tier 1.1: freshness is now first-class. is_active = false means the
    -- listing missed N consecutive successful runs (sold / delisted); the site
    -- filters on it. last_seen_at drives the "last seen N days ago" display.
    -- Appended after the existing columns so Power BI column order is preserved.
    l.is_active,
    l.last_seen_at
FROM listings AS l
INNER JOIN (
    SELECT DISTINCT ON (source, listing_id)
           source,
           listing_id,
           snapshot_date,
           price,
           days_on_market,
           price_per_sqft,
           price_drop_pct,
           motivation_score,
           motivation_reason
    FROM listing_snapshots
    ORDER BY source, listing_id, snapshot_date DESC
) AS s
  ON s.source = l.source
 AND s.listing_id = l.listing_id;

-- -----------------------------------------------------------------------------
-- vw_listing_history -- one row per (source, listing_id, snapshot_date): the
-- FULL daily snapshot history, with none of the "latest only" reduction applied
-- by vw_latest_listings. UNIQUE (source, listing_id, snapshot_date) on the base
-- table guarantees exactly one row per tuple. Feeds the per-listing
-- price-history panel / endpoint (Tier 1.2): a seller who cut $50k, then $25k,
-- then held over 60 days is only visible across rows. Base numeric types are
-- kept (price_per_sqft numeric(10,2), price_drop_pct numeric(6,2)) — the API
-- layer casts, consistent with the other views in this file.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_listing_history AS
SELECT
    source,
    listing_id,
    snapshot_date,
    price,
    previous_price,
    price_reduced,
    days_on_market,
    price_per_sqft,
    price_drop_pct,
    motivation_score,
    motivation_reason,
    scraped_at
FROM listing_snapshots;

-- -----------------------------------------------------------------------------
-- vw_zip_price_drop_30d -- avg(price_drop_pct) + row count per zip per
-- snapshot_date for the last 30 days; zip comes from listings via the
-- (source, listing_id) FK join ("joined via listings.zip").
--   * snapshot_date >= CURRENT_DATE - 30 : CURRENT_DATE is a date, integer
--     subtraction keeps the comparison type-correct in Postgres.
--   * AVG() ignores rows whose price_drop_pct is NULL (no prior price);
--     listing_count counts every snapshot row in the zip/day.
--   * l.zip IS NOT NULL: Power BI's trend legend cannot use a blank zip.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_zip_price_drop_30d AS
SELECT
    l.zip,
    s.snapshot_date,
    AVG(s.price_drop_pct) AS avg_price_drop_pct,
    COUNT(*)              AS listing_count
FROM listing_snapshots AS s
INNER JOIN listings AS l
  ON l.source = s.source
 AND l.listing_id = s.listing_id
WHERE s.snapshot_date >= CURRENT_DATE - 30
  AND l.zip IS NOT NULL
GROUP BY l.zip, s.snapshot_date;

COMMIT;
