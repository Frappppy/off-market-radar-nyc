// WHAT:     /trends KPI derivation + the tri-state text helpers the KPI cells
//           and the charts' sr-only summaries share.
// WHY:      both were inline in app/trends/page.tsx (493 lines) —
//           REFACTOR_PLAN §5 Phase 3. `kpis()` is the useMemo body moved
//           verbatim; nothing about the numbers changed.
// INPUTS:   the filtered `deals` rows plus the useDeals tri-state
//           (`loaded`, `loadError`) — a failed fetch is NOT zero listings.
// OUTPUTS:  the 4-cell [label, value, note] array; `makeDescribe(loaded,
//           loadError)` builds the summary function with the same three states.
// CALLERS:  app/trends/page.tsx (kpis + describe), the charts under
//           app/trends/charts/ (via describe).

import type { Deal } from "@/lib/api-types";
import { fmtUsd, fmtPct } from "@/lib/format";
import { median } from "@/lib/stats";

// Gate fix — text helpers for the sr-only equivalents of the charts. `pct`
// accepts `unknown` because recharts rows are `Record<string, unknown>`, so the
// typeof/isFinite guard stays HERE (parseNum would also accept a numeric
// STRING like "4.5" and print it, where this has always said "no data");
// only the one-decimal rendering is fmtPct's.
// Verified by: NOTHING (gap) — nothing feeds "4.5"/Infinity/NaN through
//   pctText to assert "no data".
export const pctText = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? fmtPct(v) : "no data";

const sentence = (label: string, items: string[]) =>
  items.length === 0 ? `${label}: no data in the current filter.` : `${label}: ${items.join("; ")}.`;

export type Describe = (label: string, items: string[]) => string;

// The chart summaries are the charts' accessible form, so they carry the same
// three states the KPIs do. `sentence()` alone would tell a screen reader
// "no data in the current filter" during the first 150–350 ms of every load —
// and, worse, after a failed fetch, where it is false in the other direction.
// Verified by: NOTHING (gap) — the gate never observes a loading/failed
//   chart summary.
export const makeDescribe = (loaded: boolean, loadError: boolean): Describe =>
  (label, items) =>
    loadError
      ? `${label}: couldn't load the listings.`
      : !loaded
        ? `${label}: loading.`
        : sentence(label, items);

export function buildKpis(deals: Deal[], loaded: boolean, loadError: boolean): Array<[string, string, string]> {
  const prices = deals.map((d) => d.price).filter((v): v is number => v != null);
  const doms = deals.map((d) => d.days_on_market).filter((v): v is number => v != null);
  const cut = deals.filter((d) => (d.price_drop_pct ?? 0) > 0).length;
  // `loadError` renders "!" rather than a number: a failed fetch is not a
  // measurement of zero listings, and saying so would be the same lie the
  // loading state was fixed for.
  // Verified by: NOTHING (gap) — no key asserts the "!" cell on a failed fetch.
  return [
    ["In filter", loadError ? "!" : loaded ? String(deals.length) : "…", loadError ? "couldn't load" : "listings shown"],
    ["With a price cut", loaded && !loadError && deals.length > 0 ? `${Math.round((cut / deals.length) * 100)}%` : "—", loaded && !loadError ? `${cut} listings` : "current filter"],
    ["Median price", loadError ? "!" : loaded ? fmtUsd(median(prices)) : "…", loadError ? "couldn't load" : "current filter"],
    ["Median DOM", loadError ? "!" : loaded && median(doms) != null ? String(Math.round(median(doms) as number)) : "…", loadError ? "couldn't load" : "days on market"],
  ];
}
