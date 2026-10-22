"use client";
// WHAT:     the /trends "Price distribution" bar chart (listings per price
//           band).
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3).
// INPUTS:   priceHist from deriveCharts, describe from kpis.ts.
// OUTPUTS:  the ChartCard section.
// CALLERS:  app/trends/page.tsx.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";
import { GRID, TICK, TIP } from "./chart-theme";
import type { Describe } from "../kpis";

export function PriceBands({ priceHist, describe }: {
  priceHist: Array<{ bucket: string; n: number }>;
  describe: Describe;
}) {
  return (
    <ChartCard
      title="Price distribution"
      caption="Where filtered inventory sits — useful for picking a price band to farm."
      summary={describe("Price distribution", priceHist.map((b) => `${b.bucket}: ${b.n} listings`))}
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
  );
}
