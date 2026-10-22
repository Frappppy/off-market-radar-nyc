-- =============================================================================
-- WHAT:      Read-only Postgres role for the Vercel presentation layer
--            (offmarket_reader) — least-privilege GRANTs, applied ONCE.
-- WHY:       The site only ever queries vw_latest_listings,
--            vw_zip_price_drop_30d, vw_listing_history (dashboard/views.sql)
--            and pipeline_runs (freshness strip); vw_listing_history feeds
--            the per-listing price-history panel. Postgres evaluates a view
--            with the view owner's privileges, so SELECT on the views is
--            sufficient — no grants on listings / listing_snapshots.
--            SECRETS: the real password is never stored in this repo. Generate
--            one, create the role here, and keep the resulting connection
--            string only in Vercel env or a gitignored .env*.local file.
-- INPUTS:    a branch where sql/schema.sql and dashboard/views.sql already exist.
-- OUTPUTS:   role offmarket_reader with SELECT on exactly the four read objects.
-- CALLERS:   apply ONCE as the project owner (psql -f, or the Neon alternative:
--            Project -> Roles -> New Role, then run only the GRANTs below).
-- TESTED BY: scripts/tier1_migration_check.py checks D1-D3 (all four objects
--            readable; listings / listing_snapshots stay permission-denied).
-- =============================================================================

-- 1. Create the role (run as the project owner). Replace the placeholder
--    before running; never commit the real value.
CREATE ROLE offmarket_reader WITH LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD';

-- 2. Connect privileges — needed to resolve the relations at all.
GRANT USAGE ON SCHEMA public TO offmarket_reader;

-- 3. The only SELECTs the application performs.
--    Verified by: scripts/tier1_migration_check.py checks D1-D3.
GRANT SELECT ON vw_latest_listings, vw_zip_price_drop_30d, vw_listing_history,
  pipeline_runs
  TO offmarket_reader;

-- 4. Verify as offmarket_reader — these must succeed:
--      SELECT count(*) FROM vw_latest_listings;
--      SELECT count(*) FROM vw_zip_price_drop_30d;
--      SELECT count(*) FROM vw_listing_history;
--      SELECT count(*) FROM pipeline_runs;
--    ...and these must fail with "permission denied":
--      SELECT count(*) FROM listings;
--      SELECT count(*) FROM listing_snapshots;
--
-- Rollback: DROP ROLE offmarket_reader;
