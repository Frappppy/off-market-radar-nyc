// WHAT:     the ONE dynamic SQL builder — `buildDealsQuery()` compiles a
//           DealQuery into a parameterised SELECT over vw_latest_listings.
// WHY:      split from lib/db.ts (REFACTOR_PLAN §5 Phase 3); the SQL text of
//           the other routes lives beside it in db/queries.ts.
// INPUTS:   a DealQuery (scores, floors, zips, price band, type, limit,
//           offset, optional windowDays).
// OUTPUTS:  { text, params } — the statement /api/deals runs. Same shape as
//           the pre-split builder apart from two deliberate changes: score
//           tokens reach SQL unfiltered (see the scores block), so the live
//           path and the frozen-CSV fallback can never disagree, and the LIMIT
//           clamp is lib/limits.ts's named rule instead of a local literal.
// CALLERS:  app/api/deals/route.ts only.

import { clampLimit } from "@/lib/limits";

export interface DealQuery {
  scores: string[]; // the reader's tokens, e.g. ["High","Medium"]; unknown ones match nothing
  minDom: number | null;
  zips: string[];
  minPrice: number | null;
  maxPrice: number | null;
  type: string | null;
  limit: number; // clamped to [1, EXPORT_LIMIT] below; pages ask for 500, the CSV for EXPORT_LIMIT
  offset: number;
  // Recency guard. ABSENT is no longer the same as 0: /api/deals defaults to 1
  // (the newest snapshot plus the day before it) so listings carried over from
  // the previous run stay visible and the "last seen" label can actually say
  // something. windowDays: 0 means "newest snapshot only" — which makes every
  // returned row tautologically current and the label inert.
  windowDays?: number;
}

// ---- the ONE dynamic SQL builder: DealQuery → parameterised SELECT ----
// Builds a parameterized SELECT over vw_latest_listings (dashboard/views.sql).
// All filters optional; every value is a bind parameter (no interpolated text —
// the ONLY interpolated value is the clamped integer window below).
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
// Verified by: /api/deals recency guard — the route's absent-param default
//   and max(snapshot_date) anchor are asserted there.
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
  // Verified by: TS — the clamps are total; the NaN gate is runtime, NOTHING
  //   (gap) — no key feeds a NaN windowDays.
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
    // The tokens go through to Postgres EXACTLY as the reader sent them. They
    // used to be filtered against SCORES here, which turned an unrecognised
    // token (`?score=Bogus`, or a typo like `Hight`) into an empty list and
    // silently DROPPED the score condition — the live path then returned the
    // whole cohort (5,000 rows) while the frozen-CSV fallback, which applies
    // the same tokens in memory, returned none. Two answers to one URL.
    // `= ANY($n::text[])` matching nothing is the honest answer, and it is the
    // same answer both paths give. Unknown tokens are simply never matched.
    // Verified by: /api/deals live-vs-fallback parity — the SQL and
    //   lib/filters.applyFilters now consume the identical token list.
    params.push(q.scores);
    conds.push(`motivation_score = ANY($${params.length}::text[])`);
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
  // The LIMIT bound goes through the same named clamp the route uses
  // (lib/limits.ts), so the SQL cannot serve more rows than the export the UI
  // quotes. `Math.min(Math.max(n,1),5000)` used to be written here as literals.
  // Verified by: TS — clampLimit is total; no key feeds a limit of 0/NaN.
  params.push(clampLimit(q.limit));
  const limitPh = `$${params.length}`;
  params.push(Math.max(q.offset, 0));
  const offsetPh = `$${params.length}`;
  const text = `
    SELECT source, listing_id, address, city, zip, latitude, longitude,
           property_type, price, days_on_market,
           -- numeric/decimal arrives as a JS string from the driver; cast to
           -- float8 so the API contract matches lib/api-types.ts (number | null)
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
