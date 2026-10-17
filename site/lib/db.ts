// Neon read path — server-only. Uses the HTTP driver required on Vercel
// serverless (@neondatabase/serverless); classic pg pools die on serverless.
// One query per API route. DATABASE_URL should be a read-only role; it lives
// in Vercel env / local .env.local, never in code.
//
// Env is read through @neon/env parseEnv against neon.ts, so the variable is
// validated against the services the project actually declares (Postgres only
// — DATABASE_URL is the pooled URL, correct for serverless app traffic).
// Called per request, never at module scope: a missing/invalid var throws
// inside the route's try/catch and degrades to the frozen sample rather than
// failing the module import.
import { parseEnv } from "@neon/env";
import { neon } from "@neondatabase/serverless";
import neonConfig from "@/neon";

export function getSql() {
  const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
  return neon(postgres.databaseUrl);
}

export interface DealQuery {
  scores: string[]; // e.g. ["High","Medium"]
  minDom: number | null;
  zips: string[];
  minPrice: number | null;
  maxPrice: number | null;
  type: string | null;
  limit: number; // map: 500 max; table: 25/page via offset
  offset: number;
  // Recency guard. ABSENT is no longer the same as 0: /api/deals defaults to 1
  // (the newest snapshot plus the day before it) so listings carried over from
  // the previous run stay visible and the "last seen" label can actually say
  // something. windowDays: 0 means "newest snapshot only" — which makes every
  // returned row tautologically current and the label inert.
  windowDays?: number;
}

// Builds a parameterized SELECT over vw_latest_listings (dashboard/views.sql).
// All filters optional; scores validated against the CHECK constraint set.
//
// The recency guard (roadmap 1.1) is ALWAYS the first WHERE condition and is
// deliberately unparameterized: a clamped integer is interpolated instead, so
// it consumes no bind slot and cannot shift the $n numbering of the optional
// conditions below it.
//
// It anchors on the dataset's own newest snapshot, never CURRENT_DATE. The
// daily job misses days (free-tier cron, failed runs) and CURRENT_DATE would
// blank the map on the very first missed run; max(snapshot_date) keeps the map
// showing the freshest thing we actually have. windowDays <= 0 pins exactly
// that snapshot; windowDays >= 1 keeps it and the N days before it.
//
// The window is the caller's decision and /api/deals answers 1 when the param
// is absent (see route.ts): a 1-day window returns the newest snapshot plus
// anything carried over from the run before it, which is what makes a
// listing's "last seen" age meaningful. `?? 0` below is therefore only the
// defensive fallback for a caller that forgets to pass a number — it is not
// the product default.
export function buildDealsQuery(q: DealQuery): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const conds: string[] = [];
  const rawWindow = q.windowDays ?? 0;
  // Number.isFinite gate: a NaN would render as `- NaN` in the SQL text.
  const windowDays = Number.isFinite(rawWindow)
    ? Math.min(Math.max(Math.floor(rawWindow), 0), 3650)
    : 0;
  const newest = `(SELECT max(snapshot_date) FROM vw_latest_listings)`;
  conds.push(
    windowDays <= 0
      ? `snapshot_date = ${newest}`
      : `snapshot_date >= ${newest} - ${windowDays}`
  );
  if (q.scores.length > 0) {
    const allowed = q.scores.filter((s) => ["High", "Medium", "Low"].includes(s));
    if (allowed.length > 0) {
      params.push(allowed);
      conds.push(`motivation_score = ANY($${params.length}::text[])`);
    }
  }
  if (q.minDom != null) {
    params.push(q.minDom);
    conds.push(`COALESCE(days_on_market, 0) >= $${params.length}`);
  }
  if (q.zips.length > 0) {
    params.push(q.zips);
    conds.push(`zip = ANY($${params.length}::text[])`);
  }
  if (q.minPrice != null) {
    params.push(q.minPrice);
    conds.push(`price >= $${params.length}`);
  }
  if (q.maxPrice != null) {
    params.push(q.maxPrice);
    conds.push(`price <= $${params.length}`);
  }
  if (q.type) {
    params.push(q.type);
    conds.push(`property_type = $${params.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  params.push(Math.min(Math.max(q.limit, 1), 5000));
  const limitPh = `$${params.length}`;
  params.push(Math.max(q.offset, 0));
  const offsetPh = `$${params.length}`;
  const text = `
    SELECT source, listing_id, address, city, zip, latitude, longitude,
           property_type, price, days_on_market,
           -- numeric/decimal arrives as a JS string from the driver; cast to
           -- float8 so the API contract matches lib/types.ts (number | null)
           -- and the frozen-CSV fallback path.
           price_per_sqft::float8 AS price_per_sqft,
           price_drop_pct::float8 AS price_drop_pct,
           motivation_score, motivation_reason,
           snapshot_date::text AS snapshot_date, url
    FROM vw_latest_listings
    ${where}
    ORDER BY
      CASE motivation_score WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
      days_on_market DESC NULLS LAST
    LIMIT ${limitPh} OFFSET ${offsetPh}
  `;
  return { text, params };
}

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
         COUNT(*) FILTER (WHERE motivation_score = 'High') AS high_count
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
// above. `last_success` / `last_failure` come back as JSON objects or null when
// no such run exists. Status values are the schema's own: running | success |
// failed.
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
                               FROM vw_latest_listings)) AS tracked
`;
