// Shared row shapes — mirror dashboard/views.sql + docs/data_contract.md.
// vw_latest_listings: one row per (source, listing_id), latest snapshot joined.
// vw_zip_price_drop_30d: one row per (zip, snapshot_date), last 30 days.

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

export const SCORE_COLORS: Record<MotivationScore, string> = {
  High: "#d62728",
  Medium: "#e6a817",
  Low: "#9aa0a6",
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
