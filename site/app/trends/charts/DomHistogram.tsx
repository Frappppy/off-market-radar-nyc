"use client";
// WHAT:     the /trends "DOM histogram" bar chart (listings per days-on-market
//           bucket).
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3).
// INPUTS:   domHist from deriveCharts, describe from kpis.ts.
// OUTPUTS:  the ChartCard section.
// CALLERS:  app/trends/page.tsx.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";
import { GRID, TICK, TIP } from "./chart-theme";
import type { Describe } from "../kpis";

export function DomHistogram({ domHist, describe }: {
  domHist: Array<{ bucket: string; n: number }>;
  describe: Describe;
}) {
  return (
    <ChartCard
      title="DOM histogram"
      caption="Stale listings pile up past 90 days — that is the High-score pool."
      summary={describe("Days on market histogram", domHist.map((b) => `${b.bucket} days: ${b.n} listings`))}
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
  );
}
