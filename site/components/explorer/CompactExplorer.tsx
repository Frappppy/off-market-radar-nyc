"use client";
// WHAT:     the compact explorer for the "/" overview — score-chip + DOM-slider
//           toolbar above a 420px map preview, with the detail card below it.
// WHY:      split from the 218-line components/Explorer.tsx (REFACTOR_PLAN §5
//           Phase 3) so each shell is one readable file. Rendering and gating
//           are unchanged: components/explorer/Explorer.tsx picks this or
//           FullExplorer behind one Suspense boundary.
// INPUTS:   none directly — filters come from the URL store via useFilters.
// OUTPUTS:  /api/deals (limit=200) + /api/meta fetches, and the query string it
//           carries over to /map.
// CALLERS:  components/explorer/Explorer.tsx (compact mode), rendered by
//           app/page.tsx.

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useDeals } from "@/hooks/useDeals";
import { useMeta } from "@/hooks/useMeta";
import { useUrlSearch, useUrlSearchReady } from "@/lib/useUrlSearch";
import DealMap from "@/components/listings/DealMap";
import FilterNotices from "@/components/filters/FilterNotices";
import SideCard from "@/components/listings/SideCard";
import { useFilters, toDealsQuery, filterNotices } from "@/lib/useFilters";
import type { Deal, MotivationScore } from "@/lib/api-types";
import type { FilterState } from "@/lib/filters";
import { SCORES, SCORE_COLORS, SCORE_PILL_TEXT } from "@/lib/scores";
import { fmtMoney } from "@/lib/format";

// ---- helpers: filters the compact toolbar cannot express ----
// S2 — the overview toolbar only carries score chips and the DOM slider. A
// shared link can also name zip / type / min_price / max_price, and those used
// to vanish: the reader saw "0 of 1011 shown" with no control to explain it and
// nothing to clear. These are the filters the compact toolbar cannot express.
// Verified by: NOTHING (gap) — no key asserts the hidden-filter labels list
//   every param the toolbar cannot edit.
function hiddenFilterLabels(f: FilterState): string[] {
  const out: string[] = [];
  if (f.zips.length > 0) out.push(`ZIP ${f.zips.join(", ")}`);
  if (f.type) out.push(`type ${f.type}`);
  if (f.minPrice != null) out.push(`min ${fmtMoney(f.minPrice)}`);
  if (f.maxPrice != null) out.push(`max ${fmtMoney(f.maxPrice)}`);
  return out;
}

// Compact mode (overview): full-width map under a single-row toolbar — the
// full sidebar lives on /map only, so the mini preview never looks squished.
// Verified by: NOTHING (gap) — home-390/1280 screenshots exist, but no key
//   asserts the toolbar/preview split.
export default function CompactExplorer() {
  const [filters, setFilters, resetFilters] = useFilters();
  const [picked, setPicked] = useState<Deal | null>(null);
  // Newest snapshot across the returned rows — the reference for "last seen"
  // (roadmap 1.1). Comes with the deals payload; no extra request. This
  // explorer keeps its OWN copy, fed by useDeals' onSuccess, instead of the
  // hook's `latestSnapshotDate`: a failed refetch must not forget the date an
  // already-open card is ageing rows against (hooks/useDeals.ts spells out the
  // disagreement with /data, which wants the opposite).
  // Verified by: NOTHING (gap) — no check refetches with a card open to
  //   assert a failed refetch keeps the ageing date.
  const [latestSnapshot, setLatestSnapshot] = useState<string | null>(null);
  const sp = useUrlSearch();
  const ready = useUrlSearchReady();
  const domId = useId();

  const query = useMemo(() => toDealsQuery(filters, { limit: "200" }), [filters]);

  // Gate fix — do not fetch against the server-snapshot default: until `ready`
  // `filters` is the SSR placeholder (score=High,Medium, min_dom=60) and
  // fetching it spends a request on a cohort the reader never asked for.
  // `enabled: ready` puts that gate on both requests, and useDeals/useMeta
  // replace the old `dead` flags with the one abort-on-supersede convention.
  // Verified by: shots/phase3-runtime-gate.json → cancelledRequests + notes
  //   (abort-on-supersede, by design); the wasted-SSR-default-fetch claim is
  //   not keyed (gap).
  const { deals } = useDeals(query, {
    enabled: ready,
    onSuccess: (r) => setLatestSnapshot(r.latest_snapshot_date ?? null),
  });
  // /api/meta is filter-independent, so it fetches once per enablement rather
  // than once per query like the effect it replaces — same value, fewer calls.
  // Verified by: NOTHING (gap) — no key counts /api/meta requests.
  const { meta } = useMeta(ready);
  const total = meta?.total_tracked ?? null;

  const toggleScore = (s: MotivationScore) => {
    const has = filters.score.includes(s);
    setFilters({ score: has ? filters.score.filter((x) => x !== s) : [...filters.score, s] });
  };

  const hidden = hiddenFilterLabels(filters);
  const notices = filterNotices(filters, sp.get("score"), sp.get("min_dom"));
  // The link keeps the WHOLE query string, which is the point: this page cannot
  // edit zip/type/price, but /map can, and it must open on the same view the
  // reader was just looking at — not on a reset one.
  // Verified by: NOTHING (gap) — no key follows "Full map →" with a carried
  //   query string.
  const qs = sp.toString();
  const mapHref = qs ? `/map?${qs}` : "/map";

  // ---- render: toolbar | disclosure panel | 420px map | side panel ----
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <div className="flex items-center gap-1.5">
          {SCORES.map((s) => (
            <button
              key={s}
              onClick={() => toggleScore(s)}
              // S6 — `px-2.5 py-0.5 text-xs` alone is 22px tall, so the three
              // score chips were standalone sub-24px targets (44x22, 48x22,
              // 67x22) even though the sweep in the QA report listed only
              // Reset and "Full map →". `.tap` raises the box to 24px.
              // Verified by: NOTHING (gap) — the 44x22/24px target sizes were
              //   measured in the QA sweep, not by any runtime-gate key.
              className={`tap rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                filters.score.includes(s) ? "border-transparent" : "border-zinc-700 text-zinc-400"
              }`}
              style={
                filters.score.includes(s)
                  ? { background: SCORE_COLORS[s], color: SCORE_PILL_TEXT[s] }
                  : undefined
              }
            >
              {s}
            </button>
          ))}
        </div>
        <label htmlFor={domId} className="flex items-center gap-2 text-xs text-zinc-400">
          DOM ≥ {filters.minDom}
          <input
            id={domId}
            type="range" min={0} max={180} step={5} value={filters.minDom}
            onChange={(e) => setFilters({ minDom: Number(e.target.value) })}
            className="h-6 w-28"
          />
        </label>
        <span className="text-xs text-zinc-400">
          {deals.length} of {total ?? "…"} shown
        </span>
        <button className="tap text-xs text-zinc-400 underline" onClick={resetFilters}>Reset</button>
        <Link href={mapHref} className="tap ml-auto text-xs font-medium text-zinc-100 underline">
          Full map →
        </Link>
      </div>
      {/* S2 — disclose what this page cannot show or edit, and hand the reader
          the one surface that can. S8 shares the panel: it states the same
          facts about params the link sent that we could not honour.
          Verified by: NOTHING (gap) — no key reads this disclosure panel. */}
      {(hidden.length > 0 || notices.length > 0) && (
        <div className="panel space-y-1 px-4 py-2 text-xs text-zinc-400">
          {hidden.length > 0 && (
            <p>
              <span className="font-medium text-amber-400">From this link:</span>{" "}
              <span className="text-zinc-200">{hidden.join(" · ")}</span> — applied to every
              number and pin below, but not editable on this page.{" "}
              <Link href={mapHref} className="tap font-medium text-zinc-100 underline">
                Open in the map explorer to edit →
              </Link>
            </p>
          )}
          <FilterNotices value={filters} />
        </div>
      )}
      <DealMap deals={deals} onPick={setPicked} height={420} />
      {/* Compact mode: the panel sits BELOW the 420px preview, never over it —
          the mini map is the whole point of the overview page. Picking another
          pin replaces `picked`, so cards never stack. Width matches the /map
          card (20rem) instead of stretching to the full map width.
          Verified by: NOTHING (gap) — no key asserts the panel's position or
          that cards never stack. */}
      {picked && (
        <div className="max-w-full sm:max-w-[20rem]">
          <SideCard deal={picked} onClose={() => setPicked(null)} latestSnapshotDate={latestSnapshot} />
        </div>
      )}
    </div>
  );
}
