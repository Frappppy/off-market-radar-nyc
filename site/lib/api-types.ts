// WHAT:     the API contract types — the row shapes every /api/* payload uses.
// WHY:      they lived in lib/types.ts, a 181-line grab-bag that also held the
//           filter state model (now lib/filters.ts) and the date helpers (now
//           lib/dates.ts) — REFACTOR_PLAN §5 Phase 3.
// INPUTS:   none — pure interfaces mirroring dashboard/views.sql +
//           docs/data_contract.md.
// OUTPUTS:  Deal, ZipTrend, Meta, ListingHistoryPoint, ListingHistoryResponse,
//           Health, DealsResponse, MotivationScore.
// CALLERS:  app/api/* (route bodies), lib/{fallback,dates,scores}, hooks/*,
//           components/*, app/{data,trends}.

// ---- API contract types: every /api/* payload shape ----
// vw_latest_listings: one row per (source, listing_id), latest snapshot joined.
// vw_zip_price_drop_30d: one row per (zip, snapshot_date), last 30 days.
// vw_listing_history: one row per (source, listing_id, snapshot_date) — the
// full daily series behind the price-history panel (roadmap 1.2).

export type MotivationScore = "High" | "Medium" | "Low";
// Verified by: TS — every consumer switches on this three-value union; a
//   fourth score fails to compile at each read site.

export interface Deal {
  source: string;
  listing_id: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  property_type: string | null;
  price: number | null;
  days_on_market: number | null;
  price_per_sqft: number | null;
  price_drop_pct: number | null;
  motivation_score: MotivationScore;
  motivation_reason: string | null;
  snapshot_date: string; // YYYY-MM-DD
  url: string | null;
}

export interface ZipTrend {
  zip: string;
  snapshot_date: string; // YYYY-MM-DD
  avg_price_drop_pct: number | null;
  listing_count: number;
}

export interface Meta {
  snapshot_date: string | null;
  records_loaded: number | null;
  source: string;
  run_id: string | null;
  live: boolean; // false = frozen CSV fallback (Neon unreachable/sleeping)
  total_tracked: number | null;
  high_count: number | null;
}

// One recorded day for one listing (roadmap 1.2). Numeric columns are cast to
// float8 in SQL, so they arrive as numbers here — same convention as Deal.
export interface ListingHistoryPoint {
  source: string;
  listing_id: string;
  snapshot_date: string; // YYYY-MM-DD
  price: number | null;
  previous_price: number | null;
  price_reduced: boolean | null;
  days_on_market: number | null;
  price_per_sqft: number | null;
  price_drop_pct: number | null;
  motivation_score: MotivationScore;
  motivation_reason: string | null;
  scraped_at: string | null;
}

// GET /api/listing/[id]. `unavailable` is the honest "we could not read the
// history view" state (view grant not applied yet, or Neon asleep): the panel
// shows "history unavailable" instead of the site breaking. live=false covers
// both that and the frozen-CSV path.
// Verified by: /api/listing/[id] unavailable invariant — the route sets the
//   flag exactly when the view is unreadable; TS keeps it optional.
export interface ListingHistoryResponse {
  listing_id: string;
  source: string;
  history: ListingHistoryPoint[];
  latest_snapshot_date: string | null;
  live: boolean;
  unavailable?: boolean;
}

// GET /api/health — ingestion health card (roadmap 1.4).
export interface Health {
  live: boolean;
  last_success: { run_id: string; finished_at: string | null; records_loaded: number | null } | null;
  last_failure: { run_id: string; finished_at: string | null; notes: string | null } | null;
  next_run_at: string; // ISO 8601 with Z; cron is 0 10 * * * UTC
  cron: string;
  runs_ok_30d: number | null;
  runs_failed_30d: number | null;
  latest_snapshot_date: string | null;
  snapshot_days: number | null; // history depth = distinct snapshot dates
  tracked: number | null; // newest-snapshot cohort
  market_reference: number; // MARKET_REFERENCE.listings disclosure denominator
  coverage_pct: number | null; // tracked / market_reference * 100, one decimal
}

// GET /api/deals. window_days echoes the recency guard actually applied;
// latest_snapshot_date is derived from the returned rows (no extra query).
// Verified by: /api/deals recency guard — window_days is echoed by the route
//   that applied it, so the field cannot drift from the query.
export interface DealsResponse {
  deals: Deal[];
  live: boolean;
  count: number;
  window_days: number;
  latest_snapshot_date: string | null;
}
