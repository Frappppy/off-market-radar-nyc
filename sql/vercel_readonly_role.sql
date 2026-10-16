-- =============================================================================
-- Project 1 — read-only role for the Vercel presentation layer.
--
-- Apply ONCE, on the branch the site reads (production), AFTER
-- sql/schema.sql and dashboard/views.sql exist.
--
-- Least privilege by design — the site only ever queries:
--   vw_latest_listings, vw_zip_price_drop_30d   (dashboard/views.sql)
--   pipeline_runs                               (freshness strip)
-- Postgres evaluates a view with the view owner's privileges, so granting
-- SELECT on the views is sufficient: no grants on listings / listing_snapshots.
--
-- SECRETS: the real password is never stored in this repo. Generate one,
-- create the role here, and keep the resulting connection string only in
-- Vercel env or a gitignored .env*.local file.
--
-- Neon console alternative: Project -> Roles -> New Role, then run only the
-- GRANT statements below as the owner.
-- =============================================================================

-- 1. Create the role (run as the project owner). Replace the placeholder
--    before running; never commit the real value.
CREATE ROLE offmarket_reader WITH LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD';

-- 2. Connect privileges — needed to resolve the relations at all.
GRANT USAGE ON SCHEMA public TO offmarket_reader;

-- 3. The only SELECTs the application performs.
GRANT SELECT ON vw_latest_listings, vw_zip_price_drop_30d, pipeline_runs
  TO offmarket_reader;

-- 4. Verify as offmarket_reader — these must succeed:
--      SELECT count(*) FROM vw_latest_listings;
--      SELECT count(*) FROM vw_zip_price_drop_30d;
--      SELECT count(*) FROM pipeline_runs;
--    ...and these must fail with "permission denied":
--      SELECT count(*) FROM listings;
--      SELECT count(*) FROM listing_snapshots;
--
-- Rollback: DROP ROLE offmarket_reader;
