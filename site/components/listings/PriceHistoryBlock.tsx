"use client";
// WHAT:     the price-history block — status messages, sparkline, snapshot
//           count, series range and the recorded-reductions list for one
//           listing's daily series.
// WHY:      it was inlined in components/listings/SideCard.tsx (237 lines —
//           REFACTOR_PLAN §5 Phase 3 wants ≤200) and the /listing/[id] page
//           shows the same block, so it lives here once. Rendered output for
//           the card is unchanged.
// INPUTS:   the tri-state from hooks/useListingHistory, plus optional `heading`
//           (the card passes nothing and gets its eyebrow <p>; a page passes an
//           <h2>) and `className` (the card's `mt-3 min-w-0` default).
// OUTPUTS:  the block markup — the sparkline is aria-hidden by design: the
//           same numbers are printed as text right below it.
// CALLERS:  components/listings/SideCard, app/listing/[id]/page.
// Verified by: NOTHING (gap) — listing.priceHistoryH2 keys the section's
//   heading, not the sparkline's aria-hidden/text equivalence.

import type { ReactNode } from "react";
import PriceSparkline from "./PriceSparkline";
import type { ListingHistoryState } from "@/hooks/useListingHistory";
import { REDUCTIONS_SHOWN, reductionsFrom } from "@/lib/reductions";
import { fmtMoney, fmtPct, parseNum } from "@/lib/format";

export default function PriceHistoryBlock({
  hist,
  heading = <p className="eyebrow">Price history</p>,
  className = "mt-3 min-w-0",
}: {
  hist: ListingHistoryState;
  heading?: ReactNode;
  className?: string;
}) {
  const points = hist.points;
  const priced = points.filter((p) => parseNum(p.price) != null);
  const reductions = reductionsFrom(points);
  const shown = reductions.slice(0, REDUCTIONS_SHOWN);
  const hidden = reductions.length - shown.length;
  const firstPriced = priced[0] ? parseNum(priced[0].price) : null;
  const lastPriced = priced[priced.length - 1] ? parseNum(priced[priced.length - 1].price) : null;

  // ---- status messages → sparkline + range → recorded reductions ----
  return (
    <div className={className}>
      {heading}

      {hist.status === "loading" && <p className="mt-1 text-[11px] text-zinc-500">loading history…</p>}

      {hist.status === "error" && (
        <p className="mt-1 text-[11px] text-zinc-500">price history unavailable — the request failed</p>
      )}

      {hist.status === "ready" && hist.unavailable && (
        <p className="mt-1 text-[11px] text-zinc-500">
          price history unavailable — the daily-series view could not be read
          (not granted yet, or the database is unreachable)
        </p>
      )}

      {hist.status === "ready" && !hist.unavailable && points.length === 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">no daily snapshots recorded for this listing yet</p>
      )}

      {hist.status === "ready" && !hist.unavailable && points.length > 0 && (
        <div className="mt-1 min-w-0">
          <PriceSparkline points={points.map((p) => ({ snapshot_date: p.snapshot_date, price: p.price }))} />
          <p className="mt-1 text-[11px] text-zinc-500">
            {points.length === 1
              ? "1 snapshot so far — the series grows with each daily run, so this is not yet a trend."
              : `${points.length} daily snapshots.`}
            {priced.length === 0 ? " No price recorded in these snapshots yet." : ""}
          </p>
          {priced.length >= 2 && firstPriced != null && lastPriced != null && (
            <p className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">
              {fmtMoney(firstPriced)} → {fmtMoney(lastPriced)}{" "}
              <span className="text-zinc-500">(oldest → newest snapshot)</span>
            </p>
          )}

          {shown.length > 0 && (
            <div className="mt-2 min-w-0">
              <p className="eyebrow">Recorded reductions</p>
              <ul className="mt-1 space-y-1">
                {shown.map((r) => (
                  <li key={r.date} className="min-w-0 break-words text-xs leading-5 text-zinc-300">
                    <span className="tabular-nums text-zinc-500">{r.date}</span> —{" "}
                    <span className="tabular-nums">
                      {fmtMoney(r.from)} → {fmtMoney(r.to)}
                    </span>{" "}
                    <span className="tabular-nums text-red-400">
                      (−{fmtMoney(r.abs)}, −{fmtPct(r.pct)})
                    </span>
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  {hidden} older {hidden === 1 ? "reduction" : "reductions"} not shown
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
