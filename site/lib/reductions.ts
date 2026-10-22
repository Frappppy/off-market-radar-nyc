// WHAT:     the price-reduction derivation — every recorded reduction for one
//           listing's history series, newest first.
// WHY:      the logic and its long "why this comparison price" rationale lived
//           inside components/listings/SideCard.tsx; the /listing/[id] page
//           shows the same list, so the derivation lives here once
//           (REFACTOR_PLAN §5 Phase 3).
// INPUTS:   ListingHistoryPoint[] in any order (the series is sorted here).
// OUTPUTS:  Reduction[] — { date, from, to, abs, pct }, newest first; empty
//           when no day's price is below its comparison price. Byte-identical
//           to the SideCard-local version.
// CALLERS:  components/listings/SideCard, app/listing/[id]/page.

import type { ListingHistoryPoint } from "./api-types";
import { parseNum } from "./format";

export type Reduction = { date: string; from: number; to: number; abs: number; pct: number };

// Every recorded reduction, newest first (roadmap 1.2).
// Trigger: the day's price is below the comparison price. The cut is only shown
// with arithmetic behind it — a row flagged price_reduced but priced at or above
// its comparison price is contradictory data, and inventing a "−$0" line would
// be worse than omitting it. The flag itself is never read here, because the
// arithmetic already implies it.
// Comparison price: the day's own `previous_price` when the column carries it
// (the scraper's record of what the price was), otherwise the nearest earlier
// priced day in this same series (our own view of it). Recorded value wins.
//
// `previous_price` is a persistent column carried on every daily row, so the
// recorded branch would otherwise re-emit the SAME cut once per snapshot day
// (e.g. 315000→295000 on both 10-15 and 10-16 for a listing cut once). A cut is
// only new on a day whose price differs from the previous day we saw — the day
// the new price first appears — so an unchanged price cannot record it twice.
// That keeps two genuinely distinct cuts (1049999→1049000, 1049000→999000)
// apart while collapsing the carried-over duplicate.
// Verified by: NOTHING (gap) — no key exercises the carried-over `previous_price`
//   duplicate path; the example rows above are hand-picked evidence.
export function reductionsFrom(points: ListingHistoryPoint[]): Reduction[] {
  const sorted = [...points].sort((a, b) =>
    a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0
  );
  const out: Reduction[] = [];
  let prevSeriesPrice: number | null = null;
  for (const p of sorted) {
    const price = parseNum(p.price);
    const recorded = parseNum(p.previous_price);
    const movedSincePrev = price != null && (prevSeriesPrice == null || price !== prevSeriesPrice);
    let from: number | null = null;
    if (movedSincePrev && price != null && recorded != null && recorded > 0 && price < recorded) from = recorded;
    else if (price != null && prevSeriesPrice != null && price < prevSeriesPrice) from = prevSeriesPrice;
    if (price != null && from != null) {
      out.push({
        date: p.snapshot_date,
        from,
        to: price,
        abs: from - price,
        pct: ((from - price) / from) * 100,
      });
    }
    if (price != null) prevSeriesPrice = price;
  }
  return out.reverse();
}

export const REDUCTIONS_SHOWN = 6;
