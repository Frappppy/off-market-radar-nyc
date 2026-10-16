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
    l.url
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
