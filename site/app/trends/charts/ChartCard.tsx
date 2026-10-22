"use client";
// WHAT:     the /trends chart frame — panel, h2 title, sr-only summary and the
//           fixed 280px (aria-hidden) chart slot, plus the shared legend-label
//           formatter.
// WHY:      the same frame wrapped all seven charts in the old 493-line
//           page.tsx; it is one component now (REFACTOR_PLAN §5 Phase 3).
// INPUTS:   title, caption, `summary` (the chart's accessible form — sr-only
//           text, because recharts paints its SVG nodes unnamed), children
//           (the recharts tree), `span` (double-width tile).
// OUTPUTS:  the <section> frame.
// CALLERS:  the seven chart components under app/trends/charts/.

import type { ReactNode } from "react";

// Gate fix (svg-img-alt) — recharts paints the pie's sectors and each scatter
// symbol with an explicit `role="img"` and no accessible name, and wraps the
// whole categorical chart in a focusable `<g role="img">`, so axe reported 78
// unnamed image nodes on this page (serious). The data is not going on a
// sighted-only diet: every chart now states the series it draws as text in an
// `sr-only` paragraph (from `summary`), and the SVG itself is `aria-hidden`
// because that text is its equivalent. The pie's own tabIndex is set to -1 so
// hiding the chart cannot leave a focusable node inside an aria-hidden subtree
// (which would replace one violation with `aria-hidden-focus`).
// Verified by: NOTHING (gap) — nothing re-runs axe; the 78-node report is
//   jobs evidence, not a runtime-gate key.
export function ChartCard({ title, caption, summary, children, span = false }: {
  title: string; caption: string; summary: string; children: ReactNode; span?: boolean;
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

// S4 — Recharts paints each legend label in the SERIES colour by default, so
// the pie's "High" label rendered #d62728 on the #141416 panel = 3.66:1 (and
// the line legend rendered several more below-AA inks). The coloured swatch
// next to each label already carries the series colour, so the text itself can
// use the body ink and clear AA without losing the association.
// Verified by: NOTHING (gap) — no key measures the 3.66:1 figure or the AA
//   fix on the legend text.
export const legendLabel = (value: string) => <span style={{ color: "#d4d4d8" }}>{value}</span>;
