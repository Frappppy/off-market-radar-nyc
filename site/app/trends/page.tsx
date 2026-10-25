"use client";
// WHAT:     the /trends page shell — header, filter notices, KPI strip,
//           ingestion-health card, the seven-chart grid and the top-deals
//           table, wired to the filter store.
// WHY:      this file was 478 lines as one component (REFACTOR_PLAN §5 Phase
//           3). The chart JSX lives in ./charts/*, the derivations in
//           ./derivations.ts, the KPI/summary text helpers in ./kpis.ts and
//           the table in ./top-deals.tsx; the shell keeps only the data
//           wiring. Every visible string and value moved verbatim.
// INPUTS:   useFilters (URL filter state), useDeals (filtered rows +
//           loaded/loadError/live tri-state), /api/zips (filter-independent
//           ZIP daily snapshots + its own live flag).
// OUTPUTS:  the rendered /trends page.
// CALLERS:  the Next.js router (app/trends/page.tsx route).
import { Suspense, useEffect, useMemo, useState } from "react";
import IngestionHealth from "@/components/status/IngestionHealth";
import CohortSource from "@/components/status/CohortSource";
import FilterNotices from "@/components/filters/FilterNotices";
import ShareLink from "@/components/filters/ShareLink";
import type { ZipTrend } from "@/lib/api-types";
import { useDeals } from "@/hooks/useDeals";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { useUrlSearchReady } from "@/lib/useUrlSearch";
import { PAGE_LIMIT_DEFAULT } from "@/lib/limits";
import { buildKpis, makeDescribe } from "./kpis";
import { deriveCharts } from "./derivations";
import { TrendLine } from "./charts/TrendLine";
import { ZipBar } from "./charts/ZipBar";
import { ScoreMix } from "./charts/ScoreMix";
import { DomHistogram } from "./charts/DomHistogram";
import { PriceBands } from "./charts/PriceBands";
import { SqftByType } from "./charts/SqftByType";
import { DomDropScatter } from "./charts/DomDropScatter";
import { TopDeals } from "./top-deals";

// ---- data wiring: filter store → useDeals / /api/zips → derivations ----
function TrendsInner() {
  const [filters] = useFilters();
  const [trends, setTrends] = useState<ZipTrend[]>([]);
  // `deals`, `loaded` and `loadError` now come from useDeals; the WHY stays
  // with this page because both incidents were measured here. Before the first
  // response there are no rows, and "In filter 0 listings shown" / "No
  // High-motivation listings in the current filter." are CLAIMS about the
  // data, not a loading state. The QA gate measured that flash at 150–350 ms
  // on every arrival at /trends. And a failed fetch must not become a claim
  // either: `loaded && loadError` is a third state data/page.tsx models —
  // without it the catch branch renders "In filter 0 listings shown", the same
  // lie in the other direction, observed once on a transient network failure
  // during the production verification of that fix.
  // Gate fix — see lib/useUrlSearch.ts. The store returns the SSR placeholder
  // for the first render, so a filter-aware fetch must wait for `ready` or it
  // races the reader's own query. This page had no staleness guard at all, so
  // the stale default-cohort response could win AND overwrite the answer;
  // `enabled: ready` plus the hook's abort is the one guard now.
  // Verified by: shots/phase3-runtime-gate.json → notes (hook abort-on-
  //   supersede); the 150–350ms flash and the transient-failure lie are
  //   measured incidents, not keys (gap).
  const ready = useUrlSearchReady();

  // /api/zips is filter-independent, so it does not wait on the store.
  // Its `live` flag is kept, not dropped: a chart drawn from the bundled
  // sample has to say so, and /api/meta's header pill cannot tell us — the
  // snapshot series and the cohort below it are two separate requests.
  // Verified by: NOTHING (gap) — no key asserts /api/zips resolves while the
  //   filter store is still settling, or reads back j.live.
  const [zipsLive, setZipsLive] = useState<boolean | null>(null);
  useEffect(() => {
    let dead = false;
    fetch("/api/zips")
      .then((r) => r.json())
      .then((j) => {
        if (dead) return;
        setTrends(j.trends ?? []);
        setZipsLive(typeof j.live === "boolean" ? j.live : null);
      })
      .catch(() => {
        if (!dead) setTrends([]);
      });
    return () => {
      dead = true;
    };
  }, []);

  // Back to "loading" on every query change (the hook does it): the old cohort
  // answers the old question and must not be shown as if it answered the new
  // one; a superseded or unmounted request is aborted and its result discarded.
  // Verified by: shots/phase3-runtime-gate.json → cancelledRequests + notes
  //   (superseded useDeals requests abort; aborts are by design, not failures).
  const { deals, loaded, loadError, live } = useDeals(
    toDealsQuery(filters, { limit: String(PAGE_LIMIT_DEFAULT) }),
    { enabled: ready }
  );

  // Every number on this page is either a cohort statistic or a snapshot
  // series, so the provenance label is the conjunction of the two requests:
  // frozen if EITHER fell back, live only once BOTH answered live.
  const cohortLive: boolean | null =
    live === false || zipsLive === false ? false : live === true && zipsLive === true ? true : null;

  // One memo for all series (was eight): same pure computations, moved to
  // derivations.ts, so every chart draws exactly the data it drew before.
  const charts = useMemo(() => deriveCharts(deals, trends), [deals, trends]);
  const kpis = buildKpis(deals, loaded, loadError);
  const describe = makeDescribe(loaded, loadError);

  // ---- render: header | notices | KPIs | health | charts | top deals ----
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Markets · Cross-section</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Market trends</h1>
          {/* F3 — this sentence used to branch on `snapshotCount`, which is 0
              until /api/zips resolves. Two problems, one fix:
              1. Correctness — the pre-data branch asserted "There is one
                 snapshot date in this view so far" while the API had two.
              2. CLS — the long branch made the h1 column 1138px of max-content
                 instead of 624, which pushed the ShareLink onto a second flex
                 line and grew the heading row (measured 179 -> 139 at 390,
                 119 -> 77 at 1280), moving the KPI strip, health card and both
                 charts 40-42px.
              The wording is now fixed and makes no count claim: the number of
              daily snapshots is already stated by the ingestion card below
              ("History depth: N daily snapshots"), so the count is not lost.
              Note: a fixed sentence also cannot change height at intermediate
              (640-1024px) widths, which a reserved min-height could not cover.
              Verified by: NOTHING (gap) — no key measures the heading row's
              width, the 40-42px shift, or the sentence's wording. */}
          <p className="mt-1 text-sm text-zinc-400">
            Reflects the current map filters. Each line is one point per ZIP per
            daily snapshot — how many daily loads have landed so far is in the
            ingestion card below.
          </p>
        </div>
        <ShareLink className="ml-auto" />
      </div>

      {/* S8 — /trends reads the same filter params as the map, so it has to say
          the same thing when a link carried one we could not honour.
          Verified by: NOTHING (gap) — no gate key loads /trends with an
          un-honourable param to compare the notice. */}
      <FilterNotices value={filters} />

      {/* Every KPI, chart and row below is counted from whichever dataset
          answered — the cohort request or the snapshot series. The header
          pill reads /api/meta, a third request, so it cannot make this claim.
          Conditional text: the frozen case adds a line here (CLS gap, same
          class as FilterNotices above), and it is the only case where the
          numbers on this page are not Neon's.
          Verified by: NOTHING (gap) — no key forces live:false on /api/deals
          or /api/zips to read this line back. */}
      {cohortLive === false && (
        <p className="text-xs text-zinc-500">
          <CohortSource live={cohortLive} suffix="the KPIs and charts" />
        </p>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-4">
        {kpis.map(([label, value, note]) => (
          <div key={label} className="bg-[#141416] p-4">
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1 text-3xl font-bold tabular-nums text-zinc-50">{value}</dd>
            <dd className="mt-1 text-xs text-zinc-500">{note}</dd>
          </div>
        ))}
      </dl>

      {/* Why a gap exists, answered before the client asks (roadmap 1.4). The
          depth claim lives here, not repeated in the chart captions below. */}
      <IngestionHealth />

      <div className="grid gap-3 md:grid-cols-2">
        <TrendLine lineData={charts.lineData} topZips={charts.topZips} describe={describe} />
        <ZipBar highByZip={charts.highByZip} describe={describe} />
        <ScoreMix mix={charts.mix} total={deals.length} describe={describe} />
        <DomHistogram domHist={charts.domHist} describe={describe} />
        <PriceBands priceHist={charts.priceHist} describe={describe} />
        <SqftByType sqftByType={charts.sqftByType} describe={describe} />
        <DomDropScatter scatter={charts.scatter} describe={describe} />
      </div>

      <TopDeals topHigh={charts.topHigh} loaded={loaded} loadError={loadError} />
    </div>
  );
}

export default function TrendsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Loading trends…</p>}>
      <TrendsInner />
    </Suspense>
  );
}
