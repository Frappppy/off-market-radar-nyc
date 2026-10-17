"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import IngestionHealth from "@/components/IngestionHealth";
import FilterNotices from "@/components/FilterNotices";
import HScroll from "@/components/HScroll";
import ShareLink from "@/components/ShareLink";
import { SCORE_COLORS, type Deal, type MotivationScore, type ZipTrend } from "@/lib/types";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { useUrlSearchReady } from "@/lib/useUrlSearch";

const LINE_COLORS = ["#d62728", "#60a5fa", "#34d399", "#a78bfa", "#fbbf24", "#f472b6"];
const TICK = { fill: "#a1a1aa", fontSize: 12 };
const TIP = { background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5" };
const GRID = "#3f3f46";

// S4 — Recharts paints each legend label in the SERIES colour by default, so
// the pie's "High" label rendered #d62728 on the #141416 panel = 3.66:1 (and
// the line legend rendered several more below-AA inks). The coloured swatch
// next to each label already carries the series colour, so the text itself can
// use the body ink and clear AA without losing the association.
const legendLabel = (value: string) => <span style={{ color: "#d4d4d8" }}>{value}</span>;

// Gate fix (svg-img-alt) — recharts paints the pie's sectors and each scatter
// symbol with an explicit `role="img"` and no accessible name, and wraps the
// whole categorical chart in a focusable `<g role="img">`, so axe reported 78
// unnamed image nodes on this page (serious). The data is not going on a
// sighted-only diet: every chart now states the series it draws as text in an
// `sr-only` paragraph (from `summary`), and the SVG itself is `aria-hidden`
// because that text is its equivalent. The pie's own tabIndex is set to -1 so
// hiding the chart cannot leave a focusable node inside an aria-hidden subtree
// (which would replace one violation with `aria-hidden-focus`).
function ChartCard({ title, caption, summary, children, span = false }: {
  title: string; caption: string; summary: string; children: React.ReactNode; span?: boolean;
}) {
  return (
    <section className={`panel p-4 ${span ? "md:col-span-2" : ""}`}>
      <h2 className="font-semibold text-zinc-100">{title}</h2>
      <p className="sr-only">{summary}</p>
      <div style={{ height: 280 }} aria-hidden="true">
        {children}
      </div>
      <p className="mt-2 text-xs text-zinc-500">{caption}</p>
    </section>
  );
}

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtUsd = (v: number | null) =>
  v == null ? "—" : `$${v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${Math.round(v / 1000)}k`}`;

// Gate fix — text helpers for the sr-only equivalents of the charts. `pct`
// accepts `unknown` because recharts rows are `Record<string, unknown>`.
const pctText = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "no data";
const sentence = (label: string, items: string[]) =>
  items.length === 0 ? `${label}: no data in the current filter.` : `${label}: ${items.join("; ")}.`;

function TrendsInner() {
  const [filters] = useFilters();
  const [trends, setTrends] = useState<ZipTrend[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  // Gate fix — see lib/useUrlSearch.ts. The store returns the SSR placeholder
  // for the first render, so a filter-aware fetch must wait for `ready` or it
  // races the reader's own query. This page had no staleness guard either, so
  // the stale default-cohort response could win AND overwrite the answer.
  const ready = useUrlSearchReady();

  // /api/zips is filter-independent, so it does not wait on the store.
  useEffect(() => {
    let dead = false;
    fetch("/api/zips")
      .then((r) => r.json())
      .then((j) => {
        if (!dead) setTrends(j.trends ?? []);
      })
      .catch(() => {
        if (!dead) setTrends([]);
      });
    return () => {
      dead = true;
    };
  }, []);

  // Gate fix — same `AbortController` guard Explorer.tsx and data/page.tsx
  // already use, so a late response can never land on a newer query.
  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetch(`/api/deals?${toDealsQuery(filters, { limit: "500" })}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setDeals(j.deals ?? []))
      .catch(() => {
        if (!ac.signal.aborted) setDeals([]);
      });
    return () => ac.abort();
  }, [ready, filters]);

  const kpis = useMemo(() => {
    const prices = deals.map((d) => d.price).filter((v): v is number => v != null);
    const doms = deals.map((d) => d.days_on_market).filter((v): v is number => v != null);
    const cut = deals.filter((d) => (d.price_drop_pct ?? 0) > 0).length;
    return [
      ["In filter", String(deals.length), "listings shown"],
      ["With a price cut", deals.length > 0 ? `${Math.round((cut / deals.length) * 100)}%` : "—", `${cut} listings`],
      ["Median price", fmtUsd(median(prices)), "current filter"],
      ["Median DOM", median(doms) != null ? String(Math.round(median(doms) as number)) : "—", "days on market"],
    ] as Array<[string, string, string]>;
  }, [deals]);

  const { lineData, topZips } = useMemo(() => {    const counts = new Map<string, number>();
    for (const t of trends) counts.set(t.zip, (counts.get(t.zip) ?? 0) + t.listing_count);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([z]) => z);
    const byDate = new Map<string, Record<string, unknown>>();
    for (const t of trends) {
      if (!top.includes(t.zip)) continue;
      const row = byDate.get(t.snapshot_date) ?? { date: t.snapshot_date };
      row[t.zip] = t.avg_price_drop_pct;
      byDate.set(t.snapshot_date, row);
    }
    return { lineData: [...byDate.values()], topZips: top };
  }, [trends]);

  const highByZip = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deals) {
      if (d.motivation_score === "High" && d.zip) m.set(d.zip, (m.get(d.zip) ?? 0) + 1);
    }
    return [...m.entries()].map(([zip, n]) => ({ zip, High: n })).sort((a, b) => b.High - a.High).slice(0, 12);
  }, [deals]);

  const mix = useMemo(() => {
    const scores: MotivationScore[] = ["High", "Medium", "Low"];
    return scores.map((s) => ({ name: s, value: deals.filter((d) => d.motivation_score === s).length }));
  }, [deals]);

  const domHist = useMemo(() => {
    const buckets = [0, 30, 60, 90, 120, 180, 1e9];
    return buckets.slice(0, -1).map((lo, i) => {
      const hi = buckets[i + 1];
      const n = deals.filter((d) => (d.days_on_market ?? 0) >= lo && (d.days_on_market ?? 0) < hi).length;
      return { bucket: hi > 180 ? `${lo}+` : `${lo}–${hi}`, n };
    });
  }, [deals]);

  const priceHist = useMemo(() => {
    const edges = [0, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, Infinity];
    const labels = ["<500k", "500–750k", "750k–1M", "1–1.5M", "1.5–2M", "2M+"];
    return edges.slice(0, -1).map((lo, i) => ({
      bucket: labels[i],
      n: deals.filter((d) => d.price != null && d.price >= lo && d.price < edges[i + 1]).length,
    }));
  }, [deals]);

  const sqftByType = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const d of deals) {
      if (d.price_per_sqft != null && d.property_type) {
        const arr = m.get(d.property_type) ?? [];
        arr.push(Number(d.price_per_sqft));
        m.set(d.property_type, arr);
      }
    }
    return [...m.entries()]
      .map(([type, xs]) => ({ type, avg: Math.round(mean(xs) ?? 0) }))
      .sort((a, b) => b.avg - a.avg);
  }, [deals]);

  const scatter = useMemo(
    () =>
      deals
        .filter((d) => d.days_on_market != null && d.price_drop_pct != null)
        .map((d) => ({ dom: d.days_on_market as number, drop: d.price_drop_pct as number, score: d.motivation_score })),
    [deals]
  );

  const topHigh = useMemo(
    () =>
      deals
        .filter((d) => d.motivation_score === "High")
        .sort((a, b) => (b.price_drop_pct ?? -1) - (a.price_drop_pct ?? -1))
        .slice(0, 10),
    [deals]
  );

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
              (640-1024px) widths, which a reserved min-height could not cover. */}
          <p className="mt-1 text-sm text-zinc-400">
            Reflects the current map filters. Each line is one point per ZIP per
            daily snapshot — how many daily loads have landed so far is in the
            ingestion card below.
          </p>
        </div>
        <ShareLink className="ml-auto" />
      </div>

      {/* S8 — /trends reads the same filter params as the map, so it has to say
          the same thing when a link carried one we could not honour. */}
      <FilterNotices value={filters} />

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
        <ChartCard
          title="Avg price drop % by ZIP — last 30 days"
          caption="One point per ZIP per daily load — a missing day is a missed ingest, detailed in the card above."
          summary={sentence(
            "Average price drop % by ZIP, latest daily snapshot",
            lineData.length === 0
              ? []
              : topZips.map((z) => `${z} ${pctText(lineData[lineData.length - 1][z])}`)
          )}
        >
          <ResponsiveContainer>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tick={TICK} />
              <YAxis tick={TICK} />
              <Tooltip contentStyle={TIP} />
              <Legend wrapperStyle={{ color: "#d4d4d8" }} formatter={legendLabel} />
              {topZips.map((z, i) => (
                <Line key={z} type="monotone" dataKey={z} dot={false} strokeWidth={2} stroke={LINE_COLORS[i % LINE_COLORS.length]} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="High-motivation count by ZIP"
          caption="Where the call list concentrates — canvass these ZIPs first."
          summary={sentence("High-motivation listings by ZIP", highByZip.map((r) => `${r.zip} ${r.High}`))}
        >
          <ResponsiveContainer>
            <BarChart data={highByZip}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="zip" tick={TICK} />
              <YAxis allowDecimals={false} tick={TICK} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="High" fill="#d62728" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Motivation mix"
          caption="Share of High / Medium / Low in the current filter."
          summary={sentence(
            "Motivation mix",
            mix.map((m) => `${m.name} ${m.value} listings (${pctText(deals.length > 0 ? (m.value / deals.length) * 100 : null)})`)
          )}
        >
          <ResponsiveContainer>
            <PieChart>
              {/* Gate fix (aria-hidden-focus) — recharts defaults `rootTabIndex`
                  to 0, so the pie's root <g> stayed keyboard-focusable inside the
                  `aria-hidden` wrapper above. That is `aria-hidden-focus`
                  (serious) rather than the `svg-img-alt` it replaced, and it was
                  also the page's one unnamed control. -1 makes it
                  programmatically focusable but not tabbable; nothing is lost,
                  because the sr-only summary is the chart's accessible form. */}
              <Pie rootTabIndex={-1} data={mix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                {mix.map((m) => (
                  <Cell key={m.name} fill={SCORE_COLORS[m.name as MotivationScore]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TIP} />
              <Legend wrapperStyle={{ color: "#d4d4d8" }} formatter={legendLabel} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="DOM histogram"
          caption="Stale listings pile up past 90 days — that is the High-score pool."
          summary={sentence("Days on market histogram", domHist.map((b) => `${b.bucket} days: ${b.n} listings`))}
        >
          <ResponsiveContainer>
            <BarChart data={domHist}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="bucket" tick={TICK} />
              <YAxis allowDecimals={false} tick={TICK} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="n" fill="#60a5fa" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Price distribution"
          caption="Where filtered inventory sits — useful for picking a price band to farm."
          summary={sentence("Price distribution", priceHist.map((b) => `${b.bucket}: ${b.n} listings`))}
        >
          <ResponsiveContainer>
            <BarChart data={priceHist}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="bucket" tick={TICK} />
              <YAxis allowDecimals={false} tick={TICK} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="n" fill="#34d399" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Avg $/sqft by property type"
          caption="Normalizes price across types — condos usually top the per-foot ranking."
          summary={sentence(
            "Average price per square foot by property type",
            sqftByType.map((r) => `${r.type} ${r.avg} dollars per square foot`)
          )}
        >
          <ResponsiveContainer>
            <BarChart data={sqftByType} margin={{ bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="type" tick={TICK} interval={0} height={40} />
              <YAxis tick={TICK} />
              <Tooltip contentStyle={TIP} />
              <Bar dataKey="avg" fill="#a78bfa" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          span
          title="DOM vs price drop — every listing"
          caption="Top-right is the strike zone: stale AND cutting. Color = motivation score."
          summary={sentence(
            "Days on market versus price drop, coloured by motivation score",
            (["High", "Medium", "Low"] as MotivationScore[]).map(
              (s) => `${s}: ${scatter.filter((p) => p.score === s).length} listings`
            )
          )}
        >
          <ResponsiveContainer>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis type="number" dataKey="dom" name="DOM" unit="d" tick={TICK} />
              <YAxis type="number" dataKey="drop" name="drop" unit="%" tick={TICK} />
              <ZAxis type="number" range={[60, 60]} />
              <Tooltip contentStyle={TIP} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={scatter} fill="#8884d8">
                {scatter.map((p, i) => (
                  <Cell key={i} fill={SCORE_COLORS[p.score]} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <section className="panel p-4">
        <h2 className="font-semibold text-zinc-100">Top High-motivation deals</h2>
        <p className="mt-1 text-xs text-zinc-500">Ranked by price-drop %. Same rows as the map — open one on Zillow to verify.</p>
        {/* S10 — this table overflowed 20px at 390. The padding above brings it
            inside the column, and HScroll keeps any future overflow disclosed
            rather than clipped. */}
        <div className="mt-2">
          <HScroll
            className="overflow-x-auto"
            hint="Swipe the table sideways for the remaining columns →"
          >
            <table className="w-full text-sm text-zinc-200">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-400">
                  {["address", "zip", "type", "price", "DOM", "drop %", "why", ""].map((h) => (
                    <th key={h} className="relative px-1.5 py-1 font-medium sm:px-2">
                      {/* Gate fix (empty-table-header) — the link column has no
                          visible label, and axe requires every `th` to have
                          discernible text. An sr-only name satisfies that
                          without changing the layout.
                          `relative` on the cell is load-bearing, not decorative:
                          `sr-only` is position:absolute, and without a
                          positioned ancestor its containing block is the initial
                          containing block, which sits OUTSIDE the `overflow-x-auto`
                          wrapper — and a scroll container does not clip an
                          absolutely positioned descendant whose containing block
                          is outside it. Measured: the name escaped the clip, landed
                          at the last column's offset and took the document from
                          scrollWidth 390 to 491 at a 390px viewport (a 101px
                          horizontal scroll on /trends). With the cell positioned,
                          the span is clipped by HScroll as it should be. */}
                      {h || <span className="sr-only">listing link</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topHigh.map((d) => (
                  <tr key={`${d.source}:${d.listing_id}`} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/60">
                    <td className="px-1.5 py-1 sm:px-2">{d.address}</td>
                    <td className="px-1.5 py-1 sm:px-2">{d.zip}</td>
                    <td className="px-1.5 py-1 sm:px-2">{d.property_type}</td>
                    <td className="px-1.5 py-1 tabular-nums sm:px-2">{d.price != null ? `$${d.price.toLocaleString()}` : "—"}</td>
                    <td className="px-1.5 py-1 tabular-nums sm:px-2">{d.days_on_market ?? "—"}</td>
                    <td className="px-1.5 py-1 tabular-nums sm:px-2">{d.price_drop_pct != null ? `${d.price_drop_pct.toFixed(1)}%` : "—"}</td>
                    <td className="px-1.5 py-1 text-xs text-zinc-400 sm:px-2">{d.motivation_reason}</td>
                    <td className="px-1.5 py-1 sm:px-2">{d.url && <a className="underline" href={d.url} target="_blank" rel="noreferrer">Zillow ↗</a>}</td>
                  </tr>
                ))}
                {topHigh.length === 0 && (
                  <tr><td colSpan={8} className="px-1.5 py-4 text-center text-zinc-500 sm:px-2">No High-motivation listings in the current filter.</td></tr>
                )}
              </tbody>
            </table>
          </HScroll>
        </div>
      </section>
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
