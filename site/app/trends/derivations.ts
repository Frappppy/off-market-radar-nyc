// WHAT:     the /trends chart-data derivations — every useMemo from the old
//           493-line page.tsx, as one pure function.
// WHY:      REFACTOR_PLAN §5 Phase 3. One `useMemo(() => deriveCharts(deals,
//           trends), [deals, trends])` in the shell replaces the eight inline
//           ones; the computations are moved verbatim, so every chart draws
//           exactly the data it drew before (a single memo means all series
//           recompute together — same outputs, coarser granularity).
// INPUTS:   the filtered `deals` rows (useDeals) and the /api/zips `trends`
//           rows (filter-independent).
// OUTPUTS:  lineData/topZips (avg drop % lines for the top 6 ZIPs),
//           highByZip (top 12), mix (score counts), domHist/priceHist
//           (histogram buckets), sqftByType (avg $/sqft per type), scatter
//           (DOM vs drop per listing) and topHigh (top 10 by drop %).
// CALLERS:  app/trends/page.tsx.
// Verified by: NOTHING (gap) — trends.topRows (2) counts the rows that
//   rendered; nothing pins the 6 / 12 / 10 caps listed in OUTPUTS above.

import { SCORES } from "@/lib/scores";
import { mean } from "@/lib/stats";
import type { Deal, ZipTrend } from "@/lib/api-types";

export interface TrendsDerived {
  lineData: Array<Record<string, unknown>>;
  topZips: string[];
  highByZip: Array<{ zip: string; High: number }>;
  mix: Array<{ name: string; value: number }>;
  domHist: Array<{ bucket: string; n: number }>;
  priceHist: Array<{ bucket: string; n: number }>;
  sqftByType: Array<{ type: string; avg: number }>;
  scatter: Array<{ dom: number; drop: number; score: Deal["motivation_score"] }>;
  topHigh: Deal[];
}

export function deriveCharts(deals: Deal[], trends: ZipTrend[]): TrendsDerived {
  const counts = new Map<string, number>();
  for (const t of trends) counts.set(t.zip, (counts.get(t.zip) ?? 0) + t.listing_count);
  const topZips = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([z]) => z);
  const byDate = new Map<string, Record<string, unknown>>();
  for (const t of trends) {
    if (!topZips.includes(t.zip)) continue;
    const row = byDate.get(t.snapshot_date) ?? { date: t.snapshot_date };
    row[t.zip] = t.avg_price_drop_pct;
    byDate.set(t.snapshot_date, row);
  }
  const lineData = [...byDate.values()];

  const highByZipMap = new Map<string, number>();
  for (const d of deals) {
    if (d.motivation_score === "High" && d.zip) {
      highByZipMap.set(d.zip, (highByZipMap.get(d.zip) ?? 0) + 1);
    }
  }
  const highByZip = [...highByZipMap.entries()]
    .map(([zip, n]) => ({ zip, High: n }))
    .sort((a, b) => b.High - a.High)
    .slice(0, 12);

  const scores = SCORES;
  const mix = scores.map((s) => ({ name: s, value: deals.filter((d) => d.motivation_score === s).length }));

  const domBuckets = [0, 30, 60, 90, 120, 180, 1e9];
  const domHist = domBuckets.slice(0, -1).map((lo, i) => {
    const hi = domBuckets[i + 1];
    const n = deals.filter((d) => (d.days_on_market ?? 0) >= lo && (d.days_on_market ?? 0) < hi).length;
    return { bucket: hi > 180 ? `${lo}+` : `${lo}–${hi}`, n };
  });

  const edges = [0, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, Infinity];
  const labels = ["<500k", "500–750k", "750k–1M", "1–1.5M", "1.5–2M", "2M+"];
  const priceHist = edges.slice(0, -1).map((lo, i) => ({
    bucket: labels[i],
    n: deals.filter((d) => d.price != null && d.price >= lo && d.price < edges[i + 1]).length,
  }));

  const sqftMap = new Map<string, number[]>();
  for (const d of deals) {
    if (d.price_per_sqft != null && d.property_type) {
      const arr = sqftMap.get(d.property_type) ?? [];
      arr.push(Number(d.price_per_sqft));
      sqftMap.set(d.property_type, arr);
    }
  }
  const sqftByType = [...sqftMap.entries()]
    .map(([type, xs]) => ({ type, avg: Math.round(mean(xs) ?? 0) }))
    .sort((a, b) => b.avg - a.avg);

  const scatter = deals
    .filter((d) => d.days_on_market != null && d.price_drop_pct != null)
    .map((d) => ({ dom: d.days_on_market as number, drop: d.price_drop_pct as number, score: d.motivation_score }));

  const topHigh = deals
    .filter((d) => d.motivation_score === "High")
    .sort((a, b) => (b.price_drop_pct ?? -1) - (a.price_drop_pct ?? -1))
    .slice(0, 10);

  return { lineData, topZips, highByZip, mix, domHist, priceHist, sqftByType, scatter, topHigh };
}
