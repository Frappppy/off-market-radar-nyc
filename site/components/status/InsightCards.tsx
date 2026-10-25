"use client";
// WHAT:     the computed insight cards on the "/" overview — three cards that
//           read the CURRENT filter cohort (/api/deals) and the snapshot meta
//           (/api/meta): where High scores concentrate, how stale/cut the
//           cohort is, and how complete the coverage is.
// WHY:      D3 — the old overview hardcoded three claim cards ("Staten Island
//           price cuts cluster", "Condos move faster than houses") that no
//           filter change and no snapshot could ever contradict
//           (REFACTOR_PLAN §5 Phase 3). These are computed from the same
//           cohort the explorer shows, so they move when the filters move.
//           Every state is honest: loading says "…", a failed fetch says so,
//           an empty filter says so — never a number before there is one.
// INPUTS:   useFilters (URL filter state), useDeals (cohort + tri-state +
//           cohort `live`, gated on the URL store's `ready` so one fetch serves
//           the reader's own query), useMeta (total_tracked → coverageNote
//           scope).
// OUTPUTS:  the <section> grid of three <article> panels.
// CALLERS:  app/page.tsx (the overview), replacing the hardcoded cards.
// Verified by: shots/phase3-runtime-gate.json → home_insights.default,
//   home_insights.scoreHigh_dom0, home_insights.respondToFilters — the cards'
//   computed strings are asserted, and the cohort moves when filters move.
//   NOTE: those keys capture the phase-3 strings; the cohort-vs-ledger
//   sentence added to the third card afterwards is not in them (it is
//   copy-level, and the gate was not re-run for it).

import { useMemo } from "react";
import { useDeals } from "@/hooks/useDeals";
import { useMeta } from "@/hooks/useMeta";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { useUrlSearchReady } from "@/lib/useUrlSearch";
import { PAGE_LIMIT_DEFAULT } from "@/lib/limits";
import { coverageNote } from "@/lib/market";
import { median } from "@/lib/stats";

const ERR = "Couldn't load listings — reload to try again.";

// ---- three insight cards → filter-cohort computation ----
export default function InsightCards() {
  const [filters] = useFilters();
  const ready = useUrlSearchReady();
  const { deals, loaded, loadError, live } = useDeals(
    toDealsQuery(filters, { limit: String(PAGE_LIMIT_DEFAULT) }),
    { enabled: ready }
  );
  const { meta } = useMeta(ready);

  const insight = useMemo(() => {
    const highByZip = new Map<string, number>();
    for (const d of deals) {
      if (d.motivation_score === "High" && d.zip) {
        highByZip.set(d.zip, (highByZip.get(d.zip) ?? 0) + 1);
      }
    }
    const top = [...highByZip.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const doms = deals.map((d) => d.days_on_market).filter((v): v is number => v != null);
    const cut = deals.filter((d) => (d.price_drop_pct ?? 0) > 0).length;
    return {
      topZip: top ? top[0] : null,
      topCount: top ? top[1] : 0,
      medDom: median(doms),
      pctCut: deals.length > 0 ? Math.round((cut / deals.length) * 100) : null,
    };
  }, [deals]);

  // Coverage scope, stated before any number reads as market-wide (the same
  // disclosure rule lib/market documents; HeroStats prints this note too, and
  // here it replaces the old hardcoded "capped on purpose" prose).
  // Verified by: NOTHING (gap) — nothing diffs this copy against lib/market's.
  const scope = coverageNote(meta?.total_tracked);

  const cards: Array<{ title: string; body: string }> = [
    {
      title: "High scores concentrate here",
      body: loadError
        ? ERR
        : !loaded
          ? "…"
          : insight.topZip != null
            ? `ZIP ${insight.topZip} has the most High-motivation listings in this filter: ${insight.topCount} of the ${deals.length} shown.`
            : deals.length === 0
              ? "No listings in the current filter."
              : "No High-motivation listings in the current filter.",
    },
    {
      title: "How stale, how cut",
      body: loadError
        ? ERR
        : !loaded
          ? "…"
          : deals.length === 0
            ? "No listings in the current filter."
            : `Median days on market: ${insight.medDom != null ? Math.round(insight.medDom) : "—"}` +
              (insight.pctCut != null ? `; ${insight.pctCut}% have already cut the price.` : "."),
    },
    {
      title: "How complete this is",
      body:
        // Provenance first, because this section mixes two datasets: the two
        // cards above are computed from the COHORT (/api/deals) and the scope
        // note below is from /api/meta. Those two requests fall back
        // independently, so the header pill cannot speak for the cards — the
        // third card states which dataset THESE numbers were counted from.
        // Verified by: NOTHING (gap) — no key forces live:false on /api/deals
        //   while /api/meta stays live to compare the sentence.
        (live === false ? "These figures come from the bundled sample, not a live run. " : "") +
        (scope != null ? `${scope}. ` : meta == null ? "… " : "No snapshot yet. ") +
        "The ingest follows robots-allowed paths at 5s pacing and hard-stops on any CAPTCHA; coverage is near-complete for Zillow actives but not guaranteed exhaustive." +
        // The score's drop half needs price history, which only comes from a
        // listing page. A cut we never saw cannot score High, so the count is a
        // floor. Stated here rather than in the KPI cell, which stays numeric.
        " Price history is only captured where a listing page was fetched, so the High count is a floor, not a ceiling." +
        // Cohort vs ledger, stated in prose on the landing page itself: the
        // tracked count a reader sees is the newest day's scan, which moves as
        // homes sell or delist — only the ever-seen total is cumulative.
        // Verified by: NOTHING (gap) — copy-level; the runtime gate predates it
        //   (its home_insights keys capture the phase-3 strings, before this
        //   sentence existed).
        " The tracked count is the newest day's scan; the full ledger only grows.",
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {cards.map((c) => (
        <article key={c.title} className="panel p-4">
          <h2 className="font-semibold text-zinc-100">{c.title}</h2>
          <p className="mt-1 text-sm text-zinc-400">{c.body}</p>
        </article>
      ))}
    </section>
  );
}
