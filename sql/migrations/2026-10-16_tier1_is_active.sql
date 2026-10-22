-- =============================================================================
-- WHAT:      Tier 1, item 1.1 migration — add listings.is_active so a listing
--            that stops appearing in the feed (sold / delisted / pulled) can
--            be marked and hidden from the map.
-- WHY:       The auditable, SAFE-TO-RE-RUN record of the manual apply order
--            (production branch, before anything reads the new column):
--              1. sql/migrations/2026-10-16_tier1_is_active.sql   (this file)
--              2. dashboard/views.sql                             (uses is_active)
--            Applying views.sql first would fail: vw_latest_listings
--            references listings.is_active, which would not exist yet.
--            The loader does not depend on this file being run by hand: the
--            same ALTER is also an upgrade guard inside sql/schema.sql, which
--            the store stage applies on every run — see
--            docs/apply_tier1_migration.md.
-- INPUTS:    a Postgres branch that already has sql/schema.sql applied.
-- OUTPUTS:   listings.is_active boolean NOT NULL DEFAULT true; IF NOT EXISTS
--            makes a re-apply a no-op, BEGIN/COMMIT keeps it all-or-nothing.
-- CALLERS:   psql "$DATABASE_URL" -f sql/migrations/2026-10-16_tier1_is_active.sql
--            ...or paste this file into the Neon console SQL editor and Run.
-- TESTED BY: tests/test_schema_sqlglot.py
--            (test_migration_parses_as_postgres_and_adds_is_active); live
--            end-to-end: scripts/tier1_migration_check.py checks A/B.
-- =============================================================================

BEGIN;

-- On PostgreSQL 11+ this is a metadata-only change: a constant non-null DEFAULT
-- is stored in the catalog (pg_attribute.attmissingval) and NO table rewrite or
-- full-table backfill happens, even for existing rows.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Nothing else is backfilled or normalised here: the loader owns the
-- true <-> false transitions (set true on every successful load, set false
-- after STALE_RUNS consecutive misses). This migration only adds the column and
-- lets the DEFAULT mark the existing back-catalogue active.

COMMIT;

-- -----------------------------------------------------------------------------
-- OPTIONAL — manual stale-marking, commented out on purpose.
-- The loader does this automatically; run this by hand only to correct a
-- historical backfill or to sweep stale rows without a full load. N counts
-- consecutive successful pipeline_runs the listing has missed.
--
-- The `count(*) >= N` gate is REQUIRED and mirrors src/store/db.py `_MARK_STALE`.
-- Verified by: tests/test_store_stale.py
-- (test_mark_stale_is_a_noop_until_enough_successful_runs_exist). A live run:
-- scripts/tier1_migration_check.py checks E1-E3.
-- Without it, a database holding fewer than N successful runs collapses the
-- cut-off onto its most recent run, and every listing absent from that one run
-- (including listings skipped by a partial run) is deactivated at once.
-- -----------------------------------------------------------------------------
-- UPDATE listings l
--    SET is_active = false
--  WHERE l.is_active
--    AND (SELECT count(*) FROM pipeline_runs WHERE status = 'success') >= 3
--    AND l.last_seen_at < (
--          SELECT MIN(r.started_at)
--            FROM (SELECT started_at
--                    FROM pipeline_runs
--                   WHERE status = 'success'
--                     AND started_at IS NOT NULL
--                   ORDER BY started_at DESC
--                   LIMIT 3) AS r);
