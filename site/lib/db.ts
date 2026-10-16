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
}

// Builds a parameterized SELECT over vw_latest_listings (dashboard/views.sql).
// All filters optional; scores validated against the CHECK constraint set.
export function buildDealsQuery(q: DealQuery): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const conds: string[] = [];
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
