"use client";
// WHAT:     the /trends "Avg $/sqft by property type" bar chart.
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3) — including the bottom margin and the
//           interval-0 axis that keep long type labels readable.
// INPUTS:   sqftByType from deriveCharts, describe from kpis.ts.
// OUTPUTS:  the ChartCard section.
// CALLERS:  app/trends/page.tsx.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";
import { GRID, TICK, TIP } from "./chart-theme";
import type { Describe } from "../kpis";

export function SqftByType({ sqftByType, describe }: {
  sqftByType: Array<{ type: string; avg: number }>;
  describe: Describe;
}) {
  return (
    <ChartCard
      title="Avg $/sqft by property type"
      caption="Normalizes price across types — condos usually top the per-foot ranking."
      summary={describe(
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
  );
}
