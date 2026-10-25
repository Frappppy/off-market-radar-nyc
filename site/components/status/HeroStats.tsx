// WHAT:   the / landing hero — eyebrow, headline with the LIVE High count,
//   coverage-disclosure paragraph, CTA row, and the four-cell stat strip.
// WHY:    Lev/Bluejack-inspired hero, but every number is computed: the old
//   version had hardcoded placeholders. Stats are snapshot-global, not
//   filter-dependent (the filtered cohort is the map's job). Inline comments
//   carry the two measured defects (F2 paragraph CLS) and why they are fixed.
// INPUTS: /api/meta via useMeta + one unfiltered cohort via useDeals
//   ("score=High,Medium,Low&min_dom=0&limit=PAGE_LIMIT_DEFAULT"); errors
//   swallowed exactly as the old inline effects swallowed them — every
//   placeholder says "…" or "—".
// OUTPUTS: the <section> hero (its h1 is the page's only h1).
// CALLERS: app/page.tsx.
"use client";
import Link from "next/link";
import { useDeals } from "@/hooks/useDeals";
import { useMeta } from "@/hooks/useMeta";
import { PAGE_LIMIT_DEFAULT } from "@/lib/limits";
import { coverageNote, fmtCount, marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";
import { fmtPct } from "@/lib/format";

// ---- landing hero: computed stats strip (snapshot-global scope) ----
// Lev/Bluejack-inspired hero: eyebrow + tight headline with the LIVE High
// count (no more hardcoded placeholder) + Bluejack-style stat row with huge
// tabular numerals. Stats are snapshot-global, not filter-dependent.
export default function HeroStats() {
  // One fetch each, no gating (this hero never had a URL gate), errors
  // swallowed exactly as the inline effect swallowed them — every placeholder
  // below already says "…" or "—" until a payload lands.
  // Verified by: NOTHING (gap) — nothing exercises the swallowed-error path.
  const { meta } = useMeta();
  const { deals, live } = useDeals(
    `score=High%2CMedium%2CLow&min_dom=0&limit=${PAGE_LIMIT_DEFAULT}`
  );

  // The two averages below are cohort numbers, but the eyebrow pill only
  // speaks for /api/meta. The two requests fall back independently, so the
  // cells that are computed from the cohort carry the cohort's own answer.
  // Verified by: NOTHING (gap) — no key forces live:false on /api/deals while
  //   /api/meta stays live to compare the two labels.
  const cohortNote = live === false ? " · bundled sample" : "";

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
  // Verified by: NOTHING (gap) — the disclosure rule is copy-level, unkeyed.
  const scope = coverageNote(meta?.total_tracked);

  const stats: Array<[string, string, string]> = [
    // "Tracked today" is deliberate: the value is the newest daily scan's
    // cohort (see lib/db/queries.ts), which moves up and down as homes sell or
    // leave the feed — never the size of the database. The total- ever-seen
    // figure sits in the note so the two can never be conflated.
    // Verified by: TS — meta.total_tracked / total_ever_tracked (Meta type).
    [
      "Tracked today",
      meta?.total_tracked != null ? fmtCount(meta.total_tracked) : "…",
      meta?.total_ever_tracked != null
        ? `${scope ?? `snapshot ${meta?.snapshot_date ?? "—"}`} · ${fmtCount(meta.total_ever_tracked)} in total`
        : scope ?? `snapshot ${meta?.snapshot_date ?? "—"}`,
    ],
    ["High motivation", high != null ? fmtCount(high) : "…", pctHigh != null ? `${pctHigh}% of tracked` : "score = High"],
    ["Avg price drop", avgDrop != null ? fmtPct(avgDrop) : "—", `across listings with a cut${cohortNote}`],
    ["Avg DOM", avgDom != null ? String(Math.round(avgDom)) : "—", `days on market${cohortNote}`],
  ];

  return (
    <section className="panel p-6 md:p-8">
      <p className="eyebrow">
        NYC · daily snapshot ·{" "}
        {meta == null ? "…" : meta.live ? "live from Neon" : "frozen fallback"}
      </p>
      <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-[1.05] tracking-tight text-zinc-50 md:text-5xl">
        {high != null ? `${high} motivated sellers` : "Motivated sellers"} in NYC
      </h1>
      <p className="mt-3 max-w-xl text-zinc-400">
        Daily Zillow scan scored for price drops + days-on-market. Drag the DOM
        slider, keep High only — the pins are the call list.
      </p>
      {/* F2 — this paragraph used to be gated on `scope`, which only exists
          after /api/meta resolves. It appeared 80px tall at 390 / 48px at
          >=1280 *after* first paint, pushing the CTA row and the KPI strip
          down by exactly that much (measured dl y 384 -> 472 at 390,
          353 -> 409 at 1280). It is now unconditional AND data-independent:
          the count and its share of the market are the two live numbers, and
          both already sit in the "Tracked" cell of the strip immediately
          below, so nothing is lost by keeping this paragraph's wording fixed
          — and a fixed paragraph cannot change height at any viewport width,
          which a reserved min-height could not guarantee between 640 and
          1024px. Verified by: NOTHING (gap) — the F2 measurements live in
          jobs/tier1-gate-fixes/evidence/gate-fixes.md §11; no runtime key
          re-measures this paragraph's height. */}
      <p
        className="mt-2 max-w-xl text-xs text-zinc-500"
        title={`Citywide count read from Zillow on ${MARKET_REFERENCE.as_of}`}
      >
        Coverage: a robots-respecting scan of{" "}
        {marketSizeLabel} {MARKET_REFERENCE.label}, refreshed daily. Ingestion
        follows robots-allowed paths only, 5s pacing, and hard-stops on any
        CAPTCHA challenge. The tracked count and its share sit in the strip below.
      </p>
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
