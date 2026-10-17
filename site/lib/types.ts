// Shared row shapes — mirror dashboard/views.sql + docs/data_contract.md.
// vw_latest_listings: one row per (source, listing_id), latest snapshot joined.
// vw_zip_price_drop_30d: one row per (zip, snapshot_date), last 30 days.
// vw_listing_history: one row per (source, listing_id, snapshot_date) — the
// full daily series behind the price-history panel (roadmap 1.2).

export type MotivationScore = "High" | "Medium" | "Low";

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
export interface DealsResponse {
  deals: Deal[];
  live: boolean;
  count: number;
  window_days: number;
  latest_snapshot_date: string | null;
}

export const SCORE_COLORS: Record<MotivationScore, string> = {
  High: "#d62728",
  Medium: "#e6a817",
  Low: "#9aa0a6",
};

// S4 — the pill is the one place a motivation token is used as a BACKGROUND
// behind text, so it needs its own foreground. `text-white` (what every pill
// used to hardcode) measured #ffffff on #e6a817 = 2.10:1 — the worst pair in
// the QA report. Dark ink on that same amber background measures 9.45:1, so
// the brand amber is kept exactly as-is and
// only the label colour changes. High keeps white (5.02:1); dark ink on
// #d62728 would be 3.96:1 and would fail. Low's #9aa0a6 takes dark ink too
// (7.5:1) — white on it was 2.64:1, which the report missed because the
// default filter (High+Medium) never renders a Low pill. The three hues stay
// distinct, so the score is still readable at a glance.
export const SCORE_PILL_TEXT: Record<MotivationScore, string> = {
  High: "#ffffff",
  Medium: "#09090b",
  Low: "#09090b",
};

export interface FilterState {
  score: MotivationScore[]; // default [High, Medium]
  minDom: number; // default 60
  minPrice: number | null;
  maxPrice: number | null;
  type: string | null;
  zips: string[]; // multi-select
}

export const DEFAULT_FILTERS: FilterState = {
  score: ["High", "Medium"],
  minDom: 60,
  minPrice: null,
  maxPrice: null,
  type: null,
  zips: [],
};

export function applyFilters(deals: Deal[], f: FilterState): Deal[] {
  return deals.filter((d) => {
    if (!f.score.includes(d.motivation_score)) return false;
    if ((d.days_on_market ?? 0) < f.minDom) return false;
    if (f.minPrice != null && (d.price ?? Infinity) < f.minPrice) return false;
    if (f.maxPrice != null && (d.price ?? -Infinity) > f.maxPrice) return false;
    if (f.type && d.property_type !== f.type) return false;
    if (f.zips.length > 0 && !f.zips.includes(d.zip ?? "")) return false;
    return true;
  });
}

// Whole-day difference of two YYYY-MM-DD strings; null when either is missing
// or unparseable. Powers the "last seen N days ago" label (roadmap 1.1). Pure:
// no Intl, no Date.now() — the dataset's newest snapshot is the reference, so
// the label stays correct even weeks after the bundle was built.
function dayNumber(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}

export function daysSince(
  snapshotDate: string | null,
  latestSnapshotDate: string | null
): number | null {
  if (!snapshotDate || !latestSnapshotDate) return null;
  const a = dayNumber(snapshotDate);
  const b = dayNumber(latestSnapshotDate);
  if (a == null || b == null) return null;
  return b - a;
}

// One wording, two surfaces (the /data table row and the detail panel), so the
// two can never drift apart. `age` is (newest snapshot − this row's snapshot)
// in whole days, i.e. the output of daysSince. The reference is always a
// snapshot date from the payload, never the browser clock: the dataset is a
// snapshot, so the label must still be right when the page is cached, when the
// bundle is stale, or when the reader's machine clock is wrong.
export function lastSeenLabel(age: number | null): string {
  if (age == null) return "last seen —";
  if (age <= 0) return "last seen today";
  if (age === 1) return "last seen yesterday";
  return `last seen ${age} days ago`;
}

// True when the row was NOT part of the newest daily run and only reached the
// page through the recency window (window_days >= 1). Those rows are
// meaningfully different from the current cohort and are marked as such.
export function isCarriedOver(age: number | null): boolean {
  return age != null && age >= 1;
}

// Short row-level form of the same fact, for surfaces with no room for the
// sentence above (the /data table).
export function carriedOverBadge(age: number | null): string | null {
  if (!isCarriedOver(age)) return null;
  return age === 1 ? "1d" : `${age}d`;
}
