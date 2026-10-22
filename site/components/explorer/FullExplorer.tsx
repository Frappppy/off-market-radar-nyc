"use client";
// WHAT:     the full explorer for /map — sticky filter sidebar beside a
//           viewport-height map, score legend, overlay detail card.
// WHY:      split from the 218-line components/Explorer.tsx (REFACTOR_PLAN §5
//           Phase 3). Rendering and gating unchanged; see CompactExplorer's
//           header for the `enabled: ready` gate rationale.
// INPUTS:   none directly — filters come from the URL store via useFilters.
// OUTPUTS:  /api/deals (limit=500) + /api/meta fetches.
// CALLERS:  components/explorer/Explorer.tsx (full mode), rendered by
//           app/map/page.tsx.

import { useMemo, useState } from "react";
import { useDeals } from "@/hooks/useDeals";
import { useMeta } from "@/hooks/useMeta";
import { useUrlSearchReady } from "@/lib/useUrlSearch";
import DealMap from "@/components/listings/DealMap";
import Filters from "@/components/filters/Filters";
import SideCard from "@/components/listings/SideCard";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import type { Deal } from "@/lib/api-types";
import { SCORES, SCORE_COLORS } from "@/lib/scores";

export default function FullExplorer() {
  const [filters, setFilters, resetFilters] = useFilters();
  const [picked, setPicked] = useState<Deal | null>(null);
  // See CompactExplorer: reference date for the panel's "last seen" label,
  // kept across a failed refetch by the same onSuccess copy.
  // Verified by: NOTHING (gap) — the same gap as CompactExplorer's copy.
  const [latestSnapshot, setLatestSnapshot] = useState<string | null>(null);
  // Gate fix — wait for the live query string before the first fetch (same
  // reason as the compact explorer above).
  // Verified by: shots/phase3-runtime-gate.json → cancelledRequests + notes
  //   (abort-on-supersede; the wasted-default-fetch claim itself is a gap).
  const ready = useUrlSearchReady();

  const query = useMemo(() => toDealsQuery(filters, { limit: "500" }), [filters]);

  const { deals } = useDeals(query, {
    enabled: ready,
    onSuccess: (r) => setLatestSnapshot(r.latest_snapshot_date ?? null),
  });
  const { meta } = useMeta(ready);
  const total = meta?.total_tracked ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <div>
          <p className="eyebrow">Map explorer</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Find the call list</h1>
        </div>
        <p className="ml-auto text-sm text-zinc-400">
          <span className="font-semibold text-zinc-100">{deals.length}</span> of {total ?? "…"} shown
          {/* S4: this hint was zinc-600 (#52525c) on #09090b = 2.58:1.
              Verified by: NOTHING (gap) — no key measures this hint's
              contrast; the 2.58:1 figure is QA-sweep evidence. */}
          <span className="text-zinc-500"> · click a pin for the deal card</span>
        </p>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[300px_1fr]">
        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100svh-160px)] lg:overflow-y-auto">
          <Filters value={filters} onChange={setFilters} onReset={resetFilters} shown={deals.length} total={total} />
        </div>
        <div className="relative">
          <DealMap deals={deals} onPick={setPicked} height="calc(100svh - 210px)" />
          <div className="panel absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-300">
            {SCORES.map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: SCORE_COLORS[s] }} />
                {s}
              </span>
            ))}
          </div>
          {picked && (
            // z-10: maplibre's control container is z-index 2 and the card can
            // span the whole map at 390px, so the panel must win the overlap —
            // the active surface should never be covered by map chrome.
            // Verified by: NOTHING (gap) — no key asserts the card stacks
            //   above maplibre's control chrome.
            <div className="absolute right-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)]">
              <SideCard
                deal={picked}
                onClose={() => setPicked(null)}
                latestSnapshotDate={latestSnapshot}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
