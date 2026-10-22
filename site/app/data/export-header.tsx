"use client";
// WHAT:     the /data page header — eyebrow/h1, the sort-and-pick hint (with
//           its loaded-vs-loading wording), the sample-data scope note, and
//           the CSV export button with its preparing/error states.
// WHY:      the 402-line app/data/page.tsx exceeded the 200-line cap by the
//           time the table and column model were out (REFACTOR_PLAN §5 Phase
//           3); this header is the block that had to move. Every string and
//           class is verbatim — including the branch that only claims the CSV
//           row count once `loaded && !loadError` (a claim before there is
//           one).
// INPUTS:   rowCount (the filtered, sorted cohort size), query (the deals
//           query string the CSV href reuses), useDeals' loaded/loadError
//           tri-state.
// OUTPUTS:  the header <div> with the export <a>/disabled <span>.
// CALLERS:  app/data/page.tsx.
// Verified by: NOTHING (gap) — no gate key reads the export button's
//   loaded-vs-loading wording.

import { fmtCount, marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";

export default function ExportHeader({ rowCount, query, loaded, loadError }: {
  rowCount: number;
  query: string;
  loaded: boolean;
  loadError: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <p className="eyebrow">Data · Export</p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Take the call list with you</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Click any column to sort, or a row for that property&apos;s price history.{" "}
          {loaded && !loadError
            ? `The CSV below is exactly these ${fmtCount(rowCount)} filtered rows — drop it into your CRM or driving app.`
            : "The CSV below exports exactly the rows matching the current filters."}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Sample data: a capped, robots-respecting Zillow scan. Citywide inventory is {marketSizeLabel}{" "}
          {MARKET_REFERENCE.label}, so this is a slice of the market rather than full coverage.
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* No ShareLink here on purpose: it already sits in the filter panel
            (see Filters.tsx), which every explorer page shares. Rendering it
            in both places gave /data two identical "Copy link" buttons.
            Verified by: NOTHING (gap) — one ShareLink per page is a
            repo-level rule, not a runtime check. */}
        {loaded && !loadError ? (
          <a
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
            href={`/api/deals?${query}&format=csv`}
          >
            Download {fmtCount(rowCount)} rows as CSV
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-lg bg-zinc-100/60 px-4 py-2 text-sm font-semibold text-zinc-950/60"
          >
            {loadError ? "Export unavailable" : "Preparing CSV…"}
          </span>
        )}
      </div>
    </div>
  );
}
