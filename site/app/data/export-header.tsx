"use client";
// WHAT:     the /data page header — eyebrow/h1, the sort-and-pick hint (with
//           its loaded-vs-loading wording), the sample-data scope note, and
//           the CSV export button with its preparing/error states.
// WHY:      the 402-line app/data/page.tsx exceeded the 200-line cap by the
//           time the table and column model were out (REFACTOR_PLAN §5 Phase
//           3); this header is the block that had to move. Every string and
//           class is verbatim — including the branch that only claims the CSV
//           row count once `loaded && !loadError` (a claim before there is
//           one), plus ONE wording correction: "The CSV below is exactly these
//           N filtered rows" was false whenever the view itself was truncated
//           at the page limit, because the export asks for the whole ceiling
//           (lib/limits.ts), not the 500 rows on screen.
// INPUTS:   rowCount (the filtered, sorted cohort size the VIEW holds), query
//           (the deals query string the CSV href reuses), useDeals'
//           loaded/loadError/live tri-state, viewLimit (what the page fetched).
// OUTPUTS:  the header <div> with the export <a>/disabled <span>.
// CALLERS:  app/data/page.tsx.
// Verified by: NOTHING (gap) — no gate key reads the export button's
//   loaded-vs-loading wording or the truncated-view sentence.

import CohortSource from "@/components/status/CohortSource";
import { fmtCount, marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";
import { EXPORT_LIMIT, PAGE_LIMIT_DEFAULT } from "@/lib/limits";

export default function ExportHeader({ rowCount, query, loaded, loadError, live, viewLimit = PAGE_LIMIT_DEFAULT }: {
  rowCount: number;
  query: string;
  loaded: boolean;
  loadError: boolean;
  live: boolean | null;
  viewLimit?: number;
}) {
  // The view can hold at most `viewLimit` rows — that is the limit the page
  // asked /api/deals for. The CSV asks for the export ceiling instead, so at
  // rowCount < viewLimit the two are the same cohort and "exactly these N
  // rows" is literally true; at rowCount === viewLimit the view is truncated
  // and the file is a superset. Say which case the reader is in.
  const viewIsTruncated = rowCount >= viewLimit;
  // The export href REWRITES the page's limit rather than appending a second
  // one: `?…&limit=500&limit=5000` parses as limit=500 (the first wins), so a
  // pasted link would say the export is 500 rows when it is the ceiling. The
  // route forces EXPORT_LIMIT for format=csv regardless (app/api/deals/route.ts)
  // — this only makes the URL state the same fact the handler applies.
  const csvParams = new URLSearchParams(query);
  csvParams.set("limit", String(EXPORT_LIMIT));
  csvParams.set("format", "csv");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <p className="eyebrow">Data · Export</p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Take the call list with you</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Click any column to sort, or a row for that property&apos;s price history.{" "}
          {!loaded || loadError
            ? `The CSV below exports every row matching the current filters — up to ${fmtCount(EXPORT_LIMIT)}.`
            : viewIsTruncated
              ? `This table holds the first ${fmtCount(viewLimit)} of the filtered cohort; the CSV exports all of it, up to ${fmtCount(EXPORT_LIMIT)} rows.`
              : `The CSV below is exactly these ${fmtCount(rowCount)} filtered rows — drop it into your CRM or driving app.`}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {/* The row count above is a claim about a dataset, and /api/meta's
              header pill cannot answer it: the cohort and the meta strip are
              separate requests, so one can fall back while the other is live. */}
          <CohortSource live={live} suffix="the rows and the CSV" />{" "}
          Coverage: a robots-respecting Zillow scan. Citywide inventory is {marketSizeLabel}{" "}
          {MARKET_REFERENCE.label}; a small share is always missing.
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
            // `limit` is written here so the href says what it fetches; the
            // route forces the export ceiling for format=csv regardless
            // (app/api/deals/route.ts), so the two cannot disagree.
            href={`/api/deals?${csvParams.toString()}`}
          >
            {viewIsTruncated
              ? `Download as CSV — up to ${fmtCount(EXPORT_LIMIT)} rows`
              : `Download ${fmtCount(rowCount)} rows as CSV`}
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
