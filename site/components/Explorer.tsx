"use client";
import { Suspense, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useUrlSearch, useUrlSearchReady } from "@/lib/useUrlSearch";
import DealMap from "./DealMap";
import FilterNotices from "./FilterNotices";
import Filters from "./Filters";
import SideCard from "./SideCard";
import { useFilters, toDealsQuery, filterNotices } from "@/lib/useFilters";
import { SCORE_COLORS, SCORE_PILL_TEXT, type Deal, type DealsResponse, type FilterState, type MotivationScore } from "@/lib/types";

const SCORES: MotivationScore[] = ["High", "Medium", "Low"];

// S2 — the overview toolbar only carries score chips and the DOM slider. A
// shared link can also name zip / type / min_price / max_price, and those used
// to vanish: the reader saw "0 of 1011 shown" with no control to explain it and
// nothing to clear. These are the filters the compact toolbar cannot express.
function hiddenFilterLabels(f: FilterState): string[] {
  const out: string[] = [];
  if (f.zips.length > 0) out.push(`ZIP ${f.zips.join(", ")}`);
  if (f.type) out.push(`type ${f.type}`);
  if (f.minPrice != null) out.push(`min $${f.minPrice.toLocaleString()}`);
  if (f.maxPrice != null) out.push(`max $${f.maxPrice.toLocaleString()}`);
  return out;
}

// Compact mode (overview): full-width map under a single-row toolbar — the
// full sidebar lives on /map only, so the mini preview never looks squished.
function CompactExplorer() {
  const [filters, setFilters, resetFilters] = useFilters();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [picked, setPicked] = useState<Deal | null>(null);
  // Newest snapshot across the returned rows — the reference for "last seen"
  // (roadmap 1.1). Comes with the deals payload; no extra request.
  const [latestSnapshot, setLatestSnapshot] = useState<string | null>(null);
  const sp = useUrlSearch();
  const ready = useUrlSearchReady();
  const domId = useId();

  const query = useMemo(() => toDealsQuery(filters, { limit: "200" }), [filters]);

  useEffect(() => {
    // Gate fix — do not fetch against the server-snapshot default. Until
    // `ready`, `filters` is the SSR placeholder (score=High,Medium, min_dom=60)
    // and fetching it spends a request on a cohort the reader never asked for.
    if (!ready) return;
    let dead = false;
    fetch(`/api/deals?${query}`)
      .then((r) => r.json())
      .then((j: DealsResponse) => {
        if (dead) return;
        setDeals(j.deals ?? []);
        setLatestSnapshot(j.latest_snapshot_date ?? null);
      })
      .catch(() => {
        if (!dead) setDeals([]);
      });
    fetch("/api/meta")
      .then((r) => r.json())
      .then((m) => {
        if (!dead) setTotal(m.total_tracked ?? null);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [ready, query]);

  const toggleScore = (s: MotivationScore) => {
    const has = filters.score.includes(s);
    setFilters({ score: has ? filters.score.filter((x) => x !== s) : [...filters.score, s] });
  };

  const hidden = hiddenFilterLabels(filters);
  const notices = filterNotices(filters, sp.get("score"), sp.get("min_dom"));
  // The link keeps the WHOLE query string, which is the point: this page cannot
  // edit zip/type/price, but /map can, and it must open on the same view the
  // reader was just looking at — not on a reset one.
  const qs = sp.toString();
  const mapHref = qs ? `/map?${qs}` : "/map";

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
          facts about params the link sent that we could not honour. */}
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
          card (20rem) instead of stretching to the full map width. */}
      {picked && (
        <div className="max-w-full sm:max-w-[20rem]">
          <SideCard deal={picked} onClose={() => setPicked(null)} latestSnapshotDate={latestSnapshot} />
        </div>
      )}
    </div>
  );
}

function FullExplorer() {
  const [filters, setFilters, resetFilters] = useFilters();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [picked, setPicked] = useState<Deal | null>(null);
  // See CompactExplorer: reference date for the panel's "last seen" label.
  const [latestSnapshot, setLatestSnapshot] = useState<string | null>(null);
  // Gate fix — wait for the live query string before the first fetch (same
  // reason as the compact explorer above).
  const ready = useUrlSearchReady();

  const query = useMemo(() => toDealsQuery(filters, { limit: "500" }), [filters]);

  useEffect(() => {
    if (!ready) return;
    let dead = false;
    fetch(`/api/deals?${query}`)
      .then((r) => r.json())
      .then((j: DealsResponse) => {
        if (dead) return;
        setDeals(j.deals ?? []);
        setLatestSnapshot(j.latest_snapshot_date ?? null);
      })
      .catch(() => {
        if (!dead) setDeals([]);
      });
    fetch("/api/meta")
      .then((r) => r.json())
      .then((m) => {
        if (!dead) setTotal(m.total_tracked ?? null);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [ready, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <div>
          <p className="eyebrow">Map explorer</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Find the call list</h1>
        </div>
        <p className="ml-auto text-sm text-zinc-400">
          <span className="font-semibold text-zinc-100">{deals.length}</span> of {total ?? "…"} shown
          {/* S4: this hint was zinc-600 (#52525c) on #09090b = 2.58:1. */}
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

export default function Explorer({ compact = false }: { compact?: boolean }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Loading explorer…</p>}>
      {compact ? <CompactExplorer /> : <FullExplorer />}
    </Suspense>
  );
}
