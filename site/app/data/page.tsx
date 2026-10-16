"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Filters from "@/components/Filters";
import { marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { SCORE_COLORS, type Deal } from "@/lib/types";

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

function ScorePill({ score }: { score: Deal["motivation_score"] }) {
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: SCORE_COLORS[score] }}>
      {score}
    </span>
  );
}

function DataInner() {
  const [filters, setFilters, resetFilters] = useFilters();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("motivation_score");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const query = useMemo(() => toDealsQuery(filters, { limit: "500" }), [filters]);

  useEffect(() => {
    setPage(0);
    fetch(`/api/deals?${query}`)
      .then((r) => r.json()).then((j) => setDeals(j.deals ?? [])).catch(() => setDeals([]));
  }, [query]);

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
    setPage(0);
    if (key === sortKey) setSortDir(sortDir === 1 ? -1 : 1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const rows = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">Data · Export</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Take the call list with you</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Click any column to sort. The CSV below is exactly these {sorted.length} filtered rows — drop it into your CRM or driving app.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Sample data: a capped, robots-respecting Zillow scan. Citywide inventory is {marketSizeLabel}{" "}
            {MARKET_REFERENCE.label}, so this is a slice of the market rather than full coverage.
          </p>
        </div>
        <a
          className="ml-auto rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
          href={`/api/deals?${query}&format=csv`}
        >
          Download {sorted.length} rows as CSV
        </a>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[280px_1fr]">
        <div className="lg:sticky lg:top-20">
          <Filters value={filters} onChange={setFilters} onReset={resetFilters} shown={sorted.length} total={null} />
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
                        className={`inline-flex items-center gap-1 hover:text-zinc-100 ${c.numeric ? "tabular-nums" : ""}`}
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
                {rows.map((d) => (
                  <tr key={`${d.source}:${d.listing_id}`} className="border-t border-white/5 hover:bg-zinc-800/60">
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 ${c.numeric ? "tabular-nums" : ""}`}>
                        {c.key === "motivation_score" ? (
                          <ScorePill score={d.motivation_score} />
                        ) : c.key === "address" && d.url ? (
                          <a className="underline" href={d.url} target="_blank" rel="noreferrer">{d.address}</a>
                        ) : (
                          cell(d, c.key)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={COLUMNS.length} className="px-2 py-8 text-center text-zinc-500">No listings match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 border-t border-white/10 p-2 text-sm text-zinc-300">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-zinc-700 px-2 py-0.5 disabled:opacity-40">← Prev</button>
            <span>Page {page + 1} of {pages}</span>
            <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border border-zinc-700 px-2 py-0.5 disabled:opacity-40">Next →</button>
          </div>
        </div>
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
