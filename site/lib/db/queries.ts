// WHAT:     the server-only SQL constants every /api/* route runs verbatim.
// WHY:      split from lib/db.ts (REFACTOR_PLAN §5 Phase 3). Keeping the SQL
//           text free of driver imports makes each statement reviewable on its
//           own — and scripts/tier1_migration_check.py F2 extracts
//           LISTING_HISTORY_QUERY straight out of this file.
// INPUTS:   none at import time — these are parameterised text constants.
// OUTPUTS:  ZIPS, META_RUN, META_SNAPSHOT (/api/zips, /api/meta),
//           LISTING_HISTORY (/api/listing/[id]), HEALTH (/api/health), all over
//           the dashboard/views.sql views + pipeline_runs.
// CALLERS:  app/api/{zips,meta,listing/[id],health}/route.ts. The deals query
//           is built dynamically in db/deals-query.ts instead.

export const ZIPS_QUERY = `
  SELECT zip, snapshot_date::text AS snapshot_date,
         avg_price_drop_pct::float8 AS avg_price_drop_pct,
         listing_count::int AS listing_count
  FROM vw_zip_price_drop_30d
  ORDER BY snapshot_date ASC, zip ASC
`;

export const META_RUN_QUERY = `
  SELECT run_id, status, source, records_loaded,
         finished_at::text AS finished_at
  FROM pipeline_runs
  WHERE status = 'success'
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 1
`;

export const META_SNAPSHOT_QUERY = `
  SELECT snapshot_date::text AS snapshot_date, COUNT(*) AS total_tracked,
         COUNT(*) FILTER (WHERE motivation_score = 'High') AS high_count,
         (SELECT count(*)::int FROM vw_latest_listings) AS total_ever_tracked
  FROM vw_latest_listings
  GROUP BY snapshot_date
  ORDER BY snapshot_date DESC
  LIMIT 1
`;

// Per-listing price history (roadmap 1.2) — one row per recorded snapshot,
// oldest first so the panel can draw a sparkline without re-sorting. Reads
// vw_listing_history (dashboard/views.sql), which a migration must grant before
// the read-only role can see it; /api/listing/[id] therefore treats ANY error
// — "permission denied for view" included — as "history unavailable" rather
// than failing. $1 = source, $2 = listing_id.
// Verified by: /api/listing/[id] unavailable invariant — the route maps every
//   query error onto the `unavailable` response flag.
export const LISTING_HISTORY_QUERY = `
  SELECT source, listing_id, snapshot_date::text AS snapshot_date, price,
         previous_price, price_reduced, days_on_market,
         price_per_sqft::float8 AS price_per_sqft,
         price_drop_pct::float8 AS price_drop_pct,
         motivation_score, motivation_reason, scraped_at::text AS scraped_at
  FROM vw_listing_history
  WHERE source = $1 AND listing_id = $2
  ORDER BY snapshot_date ASC
`;

// Ingestion health card (roadmap 1.4) — every aggregate in SQL, one round trip
// (scalar subqueries inside a single SELECT). History depth is read from
// vw_latest_listings, which the read-only role is already granted, so no second
// query is needed.
//
// `tracked` is the newest-snapshot cohort, not the whole view: vw_latest_listings
// keeps one row per listing EVER seen, so count(*) over it includes stale and
// delisted homes and would overstate coverage. This matches META_SNAPSHOT_QUERY
// above. `total_ever_tracked` is that whole-view count on purpose — the ledger
// of every listing ever ingested (upsert-only, so it only grows) — so the card
// can show "today's scan" beside "tracked in total" and a reader never mistakes
// the moving daily cohort for a shrinking database. `last_success` /
// `last_failure` come back as JSON objects or null when no such run exists.
// Status values are the schema's own: running | success | failed.
// Verified by: /api/health newest-snapshot-cohort invariant — `tracked` counts
//   the max(snapshot_date) day only, never the whole ever-seen view.
export const HEALTH_QUERY = `
  SELECT
    (SELECT count(*)::int FROM pipeline_runs
      WHERE status = 'success'
        AND finished_at >= now() - interval '30 days') AS runs_ok_30d,
    (SELECT count(*)::int FROM pipeline_runs
      WHERE status = 'failed'
        AND finished_at >= now() - interval '30 days') AS runs_failed_30d,
    (SELECT json_build_object('run_id', run_id,
                              'finished_at', finished_at::text,
                              'records_loaded', records_loaded)
       FROM pipeline_runs
      WHERE status = 'success'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1) AS last_success,
    (SELECT json_build_object('run_id', run_id,
                              'finished_at', finished_at::text,
                              'notes', notes)
       FROM pipeline_runs
      WHERE status = 'failed'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1) AS last_failure,
    (SELECT count(DISTINCT snapshot_date)::int
       FROM vw_latest_listings) AS snapshot_days,
    (SELECT max(snapshot_date)::text
       FROM vw_latest_listings) AS latest_snapshot_date,
    (SELECT count(*)::int FROM vw_latest_listings
      WHERE snapshot_date = (SELECT max(snapshot_date)
                               FROM vw_latest_listings)) AS tracked,
    (SELECT count(*)::int FROM vw_latest_listings) AS total_ever_tracked
`;
