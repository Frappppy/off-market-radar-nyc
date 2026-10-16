"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { coverageNote, fmtCount, MARKET_REFERENCE } from "@/lib/market";
import type { Deal, Meta } from "@/lib/types";

// Lev/Bluejack-inspired hero: eyebrow + tight headline with the LIVE High
// count (no more hardcoded placeholder) + Bluejack-style stat row with huge
// tabular numerals. Stats are snapshot-global, not filter-dependent.
export default function HeroStats() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);

  useEffect(() => {
    fetch("/api/meta").then((r) => r.json()).then(setMeta).catch(() => {});
    fetch("/api/deals?score=High%2CMedium%2CLow&min_dom=0&limit=500")
      .then((r) => r.json())
      .then((j) => setDeals(j.deals ?? []))
      .catch(() => {});
  }, []);

  const drops = deals.map((d) => d.price_drop_pct).filter((v): v is number => v != null);
  const doms = deals.map((d) => d.days_on_market).filter((v): v is number => v != null);
  const avgDrop = drops.length > 0 ? drops.reduce((a, b) => a + b, 0) / drops.length : null;
  const avgDom = doms.length > 0 ? doms.reduce((a, b) => a + b, 0) / doms.length : null;
  const high = meta?.high_count;
  const pctHigh =
    meta?.total_tracked != null && meta.total_tracked > 0 && high != null
      ? Math.round((high / meta.total_tracked) * 100)
      : null;
  // How big our slice is, stated before any number is read as market-wide.
  const scope = coverageNote(meta?.total_tracked);

  const stats: Array<[string, string, string]> = [
    ["Tracked", meta?.total_tracked != null ? fmtCount(meta.total_tracked) : "…", scope ?? `snapshot ${meta?.snapshot_date ?? "—"}`],
    ["High motivation", high != null ? fmtCount(high) : "…", pctHigh != null ? `${pctHigh}% of tracked` : "score = High"],
    ["Avg price drop", avgDrop != null ? `${avgDrop.toFixed(1)}%` : "—", "across listings with a cut"],
    ["Avg DOM", avgDom != null ? String(Math.round(avgDom)) : "—", "days on market"],
  ];

  return (
    <section className="panel p-6 md:p-8">
      <p className="eyebrow">
        NYC · sample snapshot ·{" "}
        {meta == null ? "…" : meta.live ? "live from Neon" : "frozen fallback"}
      </p>
      <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-[1.05] tracking-tight text-zinc-50 md:text-5xl">
        {high != null ? `${high} motivated sellers` : "Motivated sellers"} in NYC this week
      </h1>
      <p className="mt-3 max-w-xl text-zinc-400">
        Daily Zillow scan scored for price drops + days-on-market. Drag the DOM
        slider, keep High only — the pins are the call list.
      </p>
      {scope && (
        <p
          className="mt-2 max-w-xl text-xs text-zinc-500"
          title={`Citywide count read from Zillow on ${MARKET_REFERENCE.as_of}`}
        >
          Sample scope: {meta?.total_tracked != null ? fmtCount(meta.total_tracked) : "…"} scored listings — {scope}.
          Ingestion is capped on purpose: robots-allowed paths only, 5s pacing,
          hard stop on any CAPTCHA challenge. So this is a sample of the market,
          not full coverage.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/map" className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">
          Explore the map →
        </Link>
        <Link href="/data" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500">
          How it scores
        </Link>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-4">
        {stats.map(([label, value, note]) => (
          <div key={label} className="bg-[#141416] p-4">
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1 text-3xl font-bold tabular-nums text-zinc-50 md:text-4xl">{value}</dd>
            <dd className="mt-1 text-xs text-zinc-500">{note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
