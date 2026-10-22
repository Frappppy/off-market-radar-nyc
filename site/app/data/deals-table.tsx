"use client";
// WHAT:     the /data results table — sortable sticky header, the 25-row body
//           with its loading/error/empty states, and the Prev/Next pager.
// WHY:      extracted verbatim from the 402-line app/data/page.tsx
//           (REFACTOR_PLAN §5 Phase 3) to keep both files under the 200-line
//           cap. The row handlers are unchanged: clicking (or Enter/Space on)
//           a row still opens the SideCard panel; the outbound Zillow anchor
//           still stopPropagation's so it works WITHOUT opening the panel.
// INPUTS:   the current page of sorted rows, the sort state + onSort, the
//           picked row + onPick, useDeals' loaded/loadError tri-state, the
//           payload's latestSnapshotDate (recency badges are measured against
//           it, never the browser clock) and page/pages + onPage.
// OUTPUTS:  the panel div with HScroll table and pager.
// CALLERS:  app/data/page.tsx.
// Verified by: shots/phase3-runtime-gate.json → data_panel.openedByClick,
//   openedByEnter, closedByEscape (the row/panel rules in the WHY above).

import HScroll from "@/components/ui/HScroll";
import ScorePill from "@/components/listings/ScorePill";
import { carriedOverBadge, daysSince, lastSeenLabel, listingKey } from "@/lib/dates";
import type { Deal } from "@/lib/api-types";
import { COLUMNS, cell, type SortKey } from "./columns";

export default function DealsTable({
  rows, latestSnapshotDate, sortKey, sortDir, onSort, picked, onPick,
  loaded, loadError, page, pages, onPage,
}: {
  rows: Deal[];
  latestSnapshotDate: string | null;
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (key: SortKey) => void;
  picked: Deal | null;
  onPick: (d: Deal) => void;
  loaded: boolean;
  loadError: boolean;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  // ---- Panel: fixed-height scroll box + sticky sortable header ----
  return (
    <div className="panel overflow-hidden">
      {/* S7 — the four right-hand columns are wider than a 390px column of
          this grid. The scroll stays inside this box (no page-level
          horizontal scroll); HScroll adds the disclosure and edge shadow.
          F4 — the box used to be born at min-h-[400px] and grow to
          max-h-[calc(100svh-260px)] when rows arrived (measured 400 -> 584
          at 390, 400 -> 640 at 1280, 400 -> 680 at 1350), which moved the
          paginator and the footer 184-280px down. The min-height now
          mirrors the max-height it already had, so the box is born at its
          final height. It costs the same floor the 400px rule already
          imposed on a short result set.
          Verified by: NOTHING (gap) — no runtime-gate key measures the box
          height, the 184-280px shift, or CLS. */}
      <HScroll
        className="max-h-[calc(100svh-260px)] min-h-[calc(100svh-260px)] overflow-auto"
        hint="Swipe the table sideways for DOM, drop %, $/sqft and score →"
      >
        <table className="w-full text-sm text-zinc-200">
          <thead className="sticky top-0 bg-[#1c1c1f]">
            <tr className="text-left text-zinc-400">
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-2 font-medium">
                  <button
                    onClick={() => onSort(c.key)}
                    className={`tap items-center gap-1 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${c.numeric ? "tabular-nums" : ""}`}
                    title={`Sort by ${c.label}`}
                  >
                    {c.label}
                    <span className={sortKey === c.key ? "text-zinc-100" : "text-zinc-500"}>
                      {sortKey === c.key ? (sortDir === 1 ? "▲" : "▼") : "△"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          {/* ---- Rows: recency badges, pick-on-click/Enter, cell rendering ---- */}
          <tbody>
            {loaded && !loadError && rows.map((d) => {
              const isPicked = picked != null && listingKey(picked) === listingKey(d);
              // Recency: 0 = in the newest daily run, >= 1 = carried over
              // from an earlier run. Measured against the payload's own
              // latest snapshot, never the browser clock.
              // Verified by: TS — daysSince(snapshotDate, latestSnapshotDate)
              //   takes only YYYY-MM-DD strings (lib/dates.ts); no clock input
              //   exists to leak the browser's Date.now().
              const age = daysSince(d.snapshot_date, latestSnapshotDate);
              const carried = carriedOverBadge(age);
              return (
                <tr
                  key={listingKey(d)}
                  tabIndex={0}
                  onClick={() => onPick(d)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(d);
                    }
                  }}
                  title="Open the property panel"
                  className={`cursor-pointer border-t border-white/5 hover:bg-zinc-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400 ${
                    isPicked ? "bg-zinc-800/80" : ""
                  }`}
                >
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 ${c.numeric ? "tabular-nums" : ""}`}>
                      {c.key === "motivation_score" ? (
                        <ScorePill score={d.motivation_score} />
                      ) : c.key === "address" ? (
                        <>
                          {d.url ? (
                            <a
                              className="underline"
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              // The outbound link must keep working without also
                              // opening the panel underneath it.
                              // Verified by: NOTHING (gap) — the gate keys
                              //   linkVisibleWithPanelOpen, not this routing.
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {d.address}
                            </a>
                          ) : (
                            cell(d, c.key)
                          )}
                          {/* Roadmap 1.1 — a row that is NOT in the newest
                              daily run is a different thing from one that
                              is; it used to render identically.
                              Verified by: NOTHING (gap) — no gate key asserts
                              the carried-over badge renders. */}
                          {carried != null && (
                            <span
                              className="ml-1 whitespace-nowrap rounded bg-amber-400/15 px-1 text-[10px] font-medium text-amber-400"
                              title={`${lastSeenLabel(age)} — snapshot ${d.snapshot_date}, not in the newest daily run`}
                            >
                              {carried}
                              <span className="sr-only">
                                {" "}
                                — {lastSeenLabel(age)}, not in the newest daily run
                              </span>
                            </span>
                          )}
                        </>
                      ) : (
                        cell(d, c.key)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!loaded && (
              <tr><td colSpan={COLUMNS.length} className="px-2 py-8 text-center text-zinc-500">Loading listings…</td></tr>
            )}
            {loaded && loadError && (
              <tr><td colSpan={COLUMNS.length} className="px-2 py-8 text-center text-zinc-500">Couldn&apos;t load listings — reload to try again.</td></tr>
            )}
            {loaded && !loadError && rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-2 py-8 text-center text-zinc-500">No listings match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </HScroll>
      {/* ---- Pager ---- */}
      <div className="flex items-center gap-2 border-t border-white/10 p-2 text-sm text-zinc-300">
        <button
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className="rounded border border-zinc-700 px-2 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span>Page {page} of {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="rounded border border-zinc-700 px-2 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
