"use client";
// WHAT:     the computed insight cards on the "/" overview — three cards that
//           read the CURRENT filter cohort (/api/deals) and the snapshot meta
//           (/api/meta): where High scores concentrate, how stale/cut the
//           cohort is, and the honest sample scope.
// WHY:      D3 — the old overview hardcoded three claim cards ("Staten Island
//           price cuts cluster", "Condos move faster than houses") that no
//           filter change and no snapshot could ever contradict
//           (REFACTOR_PLAN §5 Phase 3). These are computed from the same
//           cohort the explorer shows, so they move when the filters move.
//           Every state is honest: loading says "…", a failed fetch says so,
//           an empty filter says so — never a number before there is one.
// INPUTS:   useFilters (URL filter state), useDeals (cohort + tri-state,
//           gated on the URL store's `ready` so one fetch serves the reader's
//           own query), useMeta (total_tracked → coverageNote scope).
// OUTPUTS:  the <section> grid of three <article> panels.
// CALLERS:  app/page.tsx (the overview), replacing the hardcoded cards.
// Verified by: shots/phase3-runtime-gate.json → home_insights.default,
//   home_insights.scoreHigh_dom0, home_insights.respondToFilters — the cards'
//   computed strings are asserted, and the cohort moves when filters move.

import { useMemo } from "react";
import { useDeals } from "@/hooks/useDeals";
import { useMeta } from "@/hooks/useMeta";
import { useFilters, toDealsQuery } from "@/lib/useFilters";
import { useUrlSearchReady } from "@/lib/useUrlSearch";
import { coverageNote } from "@/lib/market";
import { median } from "@/lib/stats";

const ERR = "Couldn't load listings — reload to try again.";

// ---- three insight cards → filter-cohort computation ----
export default function InsightCards() {
  const [filters] = useFilters();
  const ready = useUrlSearchReady();
  const { deals, loaded, loadError } = useDeals(toDealsQuery(filters, { limit: "500" }), {
    enabled: ready,
  });
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

  // Sample scope, stated before any number reads as market-wide (the same
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
      title: "Capped on purpose, not broken",
      body:
        (scope != null ? `${scope}. ` : meta == null ? "… " : "No snapshot yet. ") +
        "The ingest follows robots-allowed paths at 5s pacing and hard-stops on any CAPTCHA, so this is a sample of NYC actives rather than full-market coverage.",
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
