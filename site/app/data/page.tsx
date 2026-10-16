"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Filters from "@/components/Filters";
import IngestionHealth from "@/components/IngestionHealth";
import SideCard from "@/components/SideCard";
import { fmtCount, marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { SCORE_COLORS, type Deal, type FilterState } from "@/lib/types";

const PAGE = 25;
const SCORE_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

type SortKey = "address" | "zip" | "property_type" | "price" | "days_on_market" | "price_drop_pct" | "price_per_sqft" | "motivation_score";

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "address", label: "address" },
  { key: "zip", label: "zip" },
  { key: "property_type", label: "type" },
  { key: "price", label: "price", numeric: true },
  { key: "days_on_market", label: "DOM", numeric: true },
  { key: "price_drop_pct", label: "drop %", numeric: true },
  { key: "price_per_sqft", label: "$/sqft", numeric: true },
  { key: "motivation_score", label: "score" },
];

// View state lives in the URL (roadmap 1.3, defect D3): a shared link has to
// reproduce "sorted by DOM desc, page 3", not only the filters. Short, stable
// param names; every read is validated so a stale or hand-typed link degrades
// to the defaults instead of rendering an unsorted or empty table.
const DEFAULT_SORT: SortKey = "motivation_score";
const DEFAULT_DIR: 1 | -1 = 1;

const isSortKey = (v: string | null): v is SortKey =>
  v != null && COLUMNS.some((c) => c.key === v);
const parseDir = (v: string | null): 1 | -1 => (v === "-1" ? -1 : 1);
// 1-based, matching the "Page N of M" the user reads in the paginator, so a
// copied link says the same thing as the screen. Garbage, 0 and negatives all
// fall back to page 1 rather than an empty table.
const parsePage = (v: string | null): number =>
  v != null && /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : 1;

function cell(d: Deal, key: SortKey): string {
  switch (key) {
    case "address": return d.address ?? "—";
    case "zip": return d.zip ?? "—";
    case "property_type": return d.property_type ?? "—";
    case "price": return d.price != null ? `$${d.price.toLocaleString()}` : "—";
    case "days_on_market": return d.days_on_market != null ? String(d.days_on_market) : "—";
    case "price_drop_pct": return d.price_drop_pct != null ? `${d.price_drop_pct.toFixed(1)}%` : "—";
    case "price_per_sqft": return d.price_per_sqft != null ? `$${Number(d.price_per_sqft).toFixed(0)}` : "—";
    case "motivation_score": return d.motivation_score;
  }
}

function sortVal(d: Deal, key: SortKey): number | string {
  if (key === "motivation_score") return SCORE_RANK[d.motivation_score] ?? 9;
  const v = (d as unknown as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  if (v == null) return key === "address" || key === "zip" || key === "property_type" ? "zzz" : -Infinity;
  return String(v);
}

const rowKey = (d: Deal) => `${d.source}:${d.listing_id}`;

function ScorePill({ score }: { score: Deal["motivation_score"] }) {
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: SCORE_COLORS[score] }}>
      {score}
    </span>
  );
}

function DataInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters, resetFilters] = useFilters();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [latestSnapshotDate, setLatestSnapshotDate] = useState<string | null>(null);
  const [picked, setPicked] = useState<Deal | null>(null);
  // `loaded` exists because the table's empty state is a CLAIM about the data
  // ("No listings match the current filters.", "Download 0 rows as CSV"). With
  // deals starting as [], that claim was rendered during the whole fetch: on a
  // cold load (Vercel + Neon) the page asserted "no listings match" for ~1-2.5s
  // while 133 listings did match, and offered an empty CSV. Never state a
  // result before there is one.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const sortRaw = sp.get("sort");
  const sortKey: SortKey = isSortKey(sortRaw) ? sortRaw : DEFAULT_SORT;
  const sortDir = parseDir(sp.get("dir"));
  const requestedPage = parsePage(sp.get("page"));

  const query = useMemo(() => toDealsQuery(filters, { limit: "500" }), [filters]);

  // Same style as useFilters: replace (no history spam), never scroll. Default
  // values are deleted rather than written, so a shared link stays minimal.
  const writeView = useCallback(
    (patch: { sort?: SortKey; dir?: 1 | -1; page?: number }) => {
      const p = new URLSearchParams(sp.toString());
      if (patch.sort !== undefined) {
        if (patch.sort === DEFAULT_SORT) p.delete("sort");
        else p.set("sort", patch.sort);
      }
      if (patch.dir !== undefined) {
        if (patch.dir === DEFAULT_DIR) p.delete("dir");
        else p.set("dir", String(patch.dir));
      }
      if (patch.page !== undefined) {
        if (patch.page <= 1) p.delete("page");
        else p.set("page", String(patch.page));
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname]
  );

  // Filter changes still reset paging to the first page — written in the SAME
  // replace as the filters, so the two navigations cannot clobber each other.
  const onFilterChange = useCallback(
    (patch: Partial<FilterState>) => setFilters(patch, { page: null }),
    [setFilters]
  );

  useEffect(() => {
    const ac = new AbortController();
    // Back to "loading" on every query change: the old rows are answers to the
    // old question, so they must not be shown as if they answered the new one.
    setLoaded(false);
    setLoadError(false);
    fetch(`/api/deals?${query}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        setDeals(j.deals ?? []);
        setLatestSnapshotDate(j.latest_snapshot_date ?? null);
        setPicked(null);
        setLoaded(true);
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setDeals([]);
          setLatestSnapshotDate(null);
          // Distinct from "no listings match": a failed fetch is not an empty
          // result, and saying so would be the same lie in the other direction.
          setLoadError(true);
          setLoaded(true);
        }
      });
    return () => ac.abort();
  }, [query]);

  // The 3-column layout only applies at lg. Below it the panel stacks AFTER the
  // table, so on a 390px screen tapping a row opened the panel ~1000px below the
  // fold and the tap looked like it did nothing. Bring it into view on narrow
  // screens only; at lg the panel is already beside the table.
  useEffect(() => {
    if (!picked) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    panelRef.current?.scrollIntoView({ block: "start" });
  }, [picked]);

  const sorted = useMemo(() => {
    const arr = [...deals];
    arr.sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sortDir;
    });
    return arr;
  }, [deals, sortKey, sortDir]);

  const clickSort = (key: SortKey) => {
    const dir: 1 | -1 = key === sortKey ? (sortDir === 1 ? -1 : 1) : 1;
    writeView({ sort: key, dir, page: 1 });
  };

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  // A shared link can name a page the current filter set no longer has. Show the
  // last real page instead of an empty table; the URL keeps the sender's page.
  const page = Math.min(Math.max(requestedPage, 1), pages);
  const rows = sorted.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">Data · Export</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Take the call list with you</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Click any column to sort, or a row for that property&apos;s price history.{" "}
            {loaded && !loadError
              ? `The CSV below is exactly these ${fmtCount(sorted.length)} filtered rows — drop it into your CRM or driving app.`
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
              in both places gave /data two identical "Copy link" buttons. */}
          {loaded && !loadError ? (
            <a
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
              href={`/api/deals?${query}&format=csv`}
            >
              Download {fmtCount(sorted.length)} rows as CSV
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
        <div className="panel overflow-hidden">
          <div className="max-h-[calc(100svh-260px)] min-h-[400px] overflow-auto">
            <table className="w-full text-sm text-zinc-200">
              <thead className="sticky top-0 bg-[#1c1c1f]">
                <tr className="text-left text-zinc-400">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 font-medium">
                      <button
                        onClick={() => clickSort(c.key)}
                        className={`inline-flex items-center gap-1 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${c.numeric ? "tabular-nums" : ""}`}
                        title={`Sort by ${c.label}`}
                      >
                        {c.label}
                        <span className={sortKey === c.key ? "text-zinc-100" : "text-zinc-600"}>
                          {sortKey === c.key ? (sortDir === 1 ? "▲" : "▼") : "△"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loaded && !loadError && rows.map((d) => {
                  const isPicked = picked != null && rowKey(picked) === rowKey(d);
                  return (
                    <tr
                      key={rowKey(d)}
                      tabIndex={0}
                      onClick={() => setPicked(d)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPicked(d);
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
                          ) : c.key === "address" && d.url ? (
                            <a
                              className="underline"
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              // The outbound link must keep working without also
                              // opening the panel underneath it.
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {d.address}
                            </a>
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
          </div>
          <div className="flex items-center gap-2 border-t border-white/10 p-2 text-sm text-zinc-300">
            <button
              disabled={page === 1}
              onClick={() => writeView({ page: page - 1 })}
              className="rounded border border-zinc-700 px-2 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>Page {page} of {pages}</span>
            <button
              disabled={page >= pages}
              onClick={() => writeView({ page: page + 1 })}
              className="rounded border border-zinc-700 px-2 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
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
