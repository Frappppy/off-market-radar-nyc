"use client";
// WHAT:     the /trends "High-motivation count by ZIP" bar chart.
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3) — title, caption, fill and summary
//           unchanged.
// INPUTS:   highByZip from deriveCharts (top 12 ZIPs by High count),
//           describe from kpis.ts.
// OUTPUTS:  the ChartCard section.
// CALLERS:  app/trends/page.tsx.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "./ChartCard";
import { GRID, TICK, TIP } from "./chart-theme";
import type { Describe } from "../kpis";

export function ZipBar({ highByZip, describe }: {
  highByZip: Array<{ zip: string; High: number }>;
  describe: Describe;
}) {
  return (
    <ChartCard
      title="High-motivation count by ZIP"
      caption="Where the call list concentrates — canvass these ZIPs first."
      summary={describe("High-motivation listings by ZIP", highByZip.map((r) => `${r.zip} ${r.High}`))}
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
  );
}
