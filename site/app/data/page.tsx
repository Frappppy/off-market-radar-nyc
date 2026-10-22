"use client";
// WHAT:     the /data page shell — URL view state (sort/dir/page), the filter
//           store, the deals fetch, and the three-column layout that puts the
//           side panel next to the table.
// WHY:      this file was 403 lines as one component (REFACTOR_PLAN §5 Phase
//           3). The column model and sort live in ./columns.ts, the URL view
//           readers/writer in ./pagination.ts and the table + pager in
//           ./deals-table.tsx. Row-click-to-panel and the URL-permalinked view
//           state are behaviour we KEEP, unchanged.
// INPUTS:   useFilters (URL filter state), useUrlSearch (view params),
//           useDeals (filtered rows + loaded/loadError tri-state + the
//           payload's latestSnapshotDate).
// OUTPUTS:  the rendered /data page.
// CALLERS:  the Next.js router (app/data/page.tsx route).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Filters from "@/components/filters/Filters";
import IngestionHealth from "@/components/status/IngestionHealth";
import SideCard from "@/components/listings/SideCard";
import { useDeals } from "@/hooks/useDeals";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { setUrlSearch, useUrlSearch, useUrlSearchReady } from "@/lib/useUrlSearch";
import type { Deal } from "@/lib/api-types";
import type { FilterState } from "@/lib/filters";
import { DEFAULT_SORT, isSortKey, sortRows, type SortKey } from "./columns";
import { PAGE, buildViewSearch, parseDir, parsePage, type ViewPatch } from "./pagination";
import DealsTable from "./deals-table";
import ExportHeader from "./export-header";

function DataInner() {
  const sp = useUrlSearch();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters, resetFilters] = useFilters();
  // Gate fix — the store's first render is the SSR placeholder `""`, so a
  // filter deep link would fetch the default cohort once before the real query
  // arrives. `enabled: ready` waits, so there is exactly one request, for the
  // reader's own query. (The hook's AbortController still guards against a
  // late response overwriting a newer one if the query changes again.)
  // Verified by: shots/phase3-runtime-gate.json → notes (useDeals
  //   abort-on-supersede); the "exactly one request" half is a gap.
  const ready = useUrlSearchReady();
  const [picked, setPicked] = useState<Deal | null>(null);
  // `deals`, `latestSnapshotDate`, `loaded` and `loadError` come from useDeals
  // (the fetch, its staleness guard and the reset-to-loading step live there).
  // The WHY for the tri-state stays this page's: the table's empty state is a
  // CLAIM about the data ("No listings match the current filters.",
  // "Download 0 rows as CSV"). With deals starting as [], that claim was
  // rendered during the whole fetch: on a cold load (Vercel + Neon) the page
  // asserted "no listings match" for ~1-2.5s while 133 listings did match, and
  // offered an empty CSV. Never state a result before there is one. A failed
  // fetch is likewise "couldn't load", not zero rows — and, per the hook's
  // rule, not a known snapshot date either (`latestSnapshotDate` clears).
  // Verified by: NOTHING (gap) — nothing observes the loading/failed states,
  //   nor the ~1-2.5s wrong-claim window (an incident, not a check).
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ---- View state from the URL (sort / dir / page) ----
  const sortRaw = sp.get("sort");
  const sortKey: SortKey = isSortKey(sortRaw) ? sortRaw : DEFAULT_SORT;
  const sortDir = parseDir(sp.get("dir"));
  const requestedPage = parsePage(sp.get("page"));

  const query = useMemo(() => toDealsQuery(filters, { limit: "500" }), [filters]);

  const writeView = useCallback(
    (patch: ViewPatch) => {
      const qs = buildViewSearch(sp, patch);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      setUrlSearch(qs);
    },
    [sp, router, pathname]
  );

  // Filter changes still reset paging to the first page — written in the SAME
  // replace as the filters, so the two navigations cannot clobber each other.
  // Verified by: NOTHING (gap) — no check inspects the URL after a filter
  //   change to see the pager reset in the same replace.
  const onFilterChange = useCallback(
    (patch: Partial<FilterState>) => setFilters(patch, { page: null }),
    [setFilters]
  );

  // ---- Cohort fetch — the tri-state lives in useDeals; only /data's own
  // success side effect stays here (a new cohort closes the open row panel,
  // on SUCCESS only — a failed fetch never closed it). Verified by: NOTHING
  // (gap) — no check exercises the failed-fetch panel rule.
  const { deals, latestSnapshotDate, loaded, loadError } = useDeals(query, {
    enabled: ready,
    onSuccess: () => setPicked(null),
  });

  // The 3-column layout only applies at lg. Below it the panel stacks AFTER the
  // table, so on a 390px screen tapping a row opened the panel ~1000px below the
  // fold and the tap looked like it did nothing. Bring it into view on narrow
  // screens only; at lg the panel is already beside the table.
  // Verified by: NOTHING (gap) — screenshots exist at 390px, but no key
  //   asserts the auto-scroll after pick.
  useEffect(() => {
    if (!picked) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    panelRef.current?.scrollIntoView({ block: "start" });
  }, [picked]);

  const sorted = useMemo(() => sortRows(deals, sortKey, sortDir), [deals, sortKey, sortDir]);

  const clickSort = (key: SortKey) => {
    const dir: 1 | -1 = key === sortKey ? (sortDir === 1 ? -1 : 1) : 1;
    writeView({ sort: key, dir, page: 1 });
  };

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  // S9 — a shared link can name a page the current filter set no longer has
  // (or never had: `?page=99999`). We still render the last real page rather
  // than an empty table, but the URL is brought into agreement with what is on
  // screen instead of leaving the address bar claiming "page 3" over a "Page 2
  // of 2" pager. Guarded on `loaded`: before the first response `sorted` is
  // empty, so clamping then would rewrite a legitimate deep link to page 1
  // before the data that justifies it has arrived.
  // Verified by: NOTHING (gap) — no runtime-gate key exercises page clamping.
  const page = Math.min(Math.max(requestedPage, 1), pages);
  useEffect(() => {
    if (!loaded || requestedPage === page) return;
    writeView({ page });
  }, [loaded, requestedPage, page, writeView]);
  const rows = sorted.slice((page - 1) * PAGE, page * PAGE);

  // ---- Layout: filters | table | (side panel when picked) ----
  return (
    <div className="space-y-4">
      <ExportHeader rowCount={sorted.length} query={query} loaded={loaded} loadError={loadError} />

      {/* Run receipt for the export: where the numbers above came from. */}
      <IngestionHealth />

      <div
        className={
          picked
            ? "grid items-start gap-3 lg:grid-cols-[280px_minmax(0,1fr)_320px]"
            : "grid items-start gap-3 lg:grid-cols-[280px_minmax(0,1fr)]"
        }
      >
        <div className="lg:sticky lg:top-20">
          <Filters value={filters} onChange={onFilterChange} onReset={resetFilters} shown={loaded && !loadError ? sorted.length : null} total={null} />
        </div>
        <DealsTable
          rows={rows}
          latestSnapshotDate={latestSnapshotDate}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={clickSort}
          picked={picked}
          onPick={setPicked}
          loaded={loaded}
          loadError={loadError}
          page={page}
          pages={pages}
          onPage={(next) => writeView({ page: next })}
        />
        {picked && (
          <div ref={panelRef} className="lg:sticky lg:top-20 scroll-mt-20">
            <SideCard
              deal={picked}
              onClose={() => setPicked(null)}
              latestSnapshotDate={latestSnapshotDate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function DataPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Loading data…</p>}>
      <DataInner />
    </Suspense>
  );
}
