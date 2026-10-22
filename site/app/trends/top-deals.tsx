// WHAT:     the /trends "Top High-motivation deals" table section — the top
//           10 rows by price-drop % with the Zillow link column.
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3); the S10 padding, HScroll disclosure
//           and the empty-table-header gate fix are all preserved as written.
// INPUTS:   topHigh rows from deriveCharts; `loaded`/`loadError` from useDeals
//           so a failed fetch says so instead of "no listings" (third state,
//           same rule as the KPI strip).
// OUTPUTS:  the <section> table.
// CALLERS:  app/trends/page.tsx.
// Verified by: NOTHING (gap) — the gate never renders this table's failed-
//   fetch state; trends.topRows only counts the rows that did render.

"use client";
import HScroll from "@/components/ui/HScroll";
import { fmtMoney, fmtPct } from "@/lib/format";
import { listingKey } from "@/lib/dates";
import type { Deal } from "@/lib/api-types";

export function TopDeals({ topHigh, loaded, loadError }: {
  topHigh: Deal[];
  loaded: boolean;
  loadError: boolean;
}) {
  return (
    <section className="panel p-4">
      <h2 className="font-semibold text-zinc-100">Top High-motivation deals</h2>
      <p className="mt-1 text-xs text-zinc-500">Ranked by price-drop %. Same rows as the map — open one on Zillow to verify.</p>
      {/* S10 — this table overflowed 20px at 390. The padding above brings it
          inside the column, and HScroll keeps any future overflow disclosed
          rather than clipped.
          Verified by: NOTHING (gap) — no key measures the 20px overflow at 390. */}
      <div className="mt-2">
        <HScroll
          className="overflow-x-auto"
          hint="Swipe the table sideways for the remaining columns →"
        >
          <table className="w-full text-sm text-zinc-200">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                {["address", "zip", "type", "price", "DOM", "drop %", "why", ""].map((h) => (
                  <th key={h} className="relative px-1.5 py-1 font-medium sm:px-2">
                    {/* Gate fix (empty-table-header) — the link column has no
                        visible label, and axe requires every `th` to have
                        discernible text. An sr-only name satisfies that
                        without changing the layout.
                        `relative` on the cell is load-bearing, not decorative:
                        `sr-only` is position:absolute, and without a
                        positioned ancestor its containing block is the initial
                        containing block, which sits OUTSIDE the `overflow-x-auto`
                        wrapper — and a scroll container does not clip an
                        absolutely positioned descendant whose containing block
                        is outside it. Measured: the name escaped the clip, landed
                        at the last column's offset and took the document from
                        scrollWidth 390 to 491 at a 390px viewport (a 101px
                        horizontal scroll on /trends). With the cell positioned,
                        the span is clipped by HScroll as it should be.
          Verified by: NOTHING (gap) — no key re-runs axe or the scrollWidth
          390→491 measurement. */}
                    {h || <span className="sr-only">listing link</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topHigh.map((d) => (
                <tr key={listingKey(d)} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/60">
                  <td className="px-1.5 py-1 sm:px-2">{d.address}</td>
                  <td className="px-1.5 py-1 sm:px-2">{d.zip}</td>
                  <td className="px-1.5 py-1 sm:px-2">{d.property_type}</td>
                  <td className="px-1.5 py-1 tabular-nums sm:px-2">{d.price != null ? fmtMoney(d.price) : "—"}</td>
                  <td className="px-1.5 py-1 tabular-nums sm:px-2">{d.days_on_market ?? "—"}</td>
                  <td className="px-1.5 py-1 tabular-nums sm:px-2">{d.price_drop_pct != null ? fmtPct(d.price_drop_pct) : "—"}</td>
                  <td className="px-1.5 py-1 text-xs text-zinc-400 sm:px-2">{d.motivation_reason}</td>
                  <td className="px-1.5 py-1 sm:px-2">{d.url && <a className="underline" href={d.url} target="_blank" rel="noreferrer">Zillow ↗</a>}</td>
                </tr>
              ))}
              {loaded && loadError && (
                <tr><td colSpan={8} className="px-1.5 py-4 text-center text-zinc-500 sm:px-2">Couldn&apos;t load listings — reload to try again.</td></tr>
              )}
              {loaded && !loadError && topHigh.length === 0 && (
                <tr><td colSpan={8} className="px-1.5 py-4 text-center text-zinc-500 sm:px-2">No High-motivation listings in the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </HScroll>
      </div>
    </section>
  );
}
