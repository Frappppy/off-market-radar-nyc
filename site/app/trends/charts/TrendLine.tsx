"use client";
// WHAT:     the /trends "Avg price drop % by ZIP" multi-series line chart.
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3). Titles, caption, series colours and the
//           sr-only summary are byte-identical to what the page rendered.
// INPUTS:   lineData + topZips from deriveCharts (one point per ZIP per daily
//           snapshot), describe from kpis.ts (tri-state summary builder).
// OUTPUTS:  the ChartCard section.
// CALLERS:  app/trends/page.tsx.

import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartCard, legendLabel } from "./ChartCard";
import { GRID, LINE_COLORS, TICK, TIP } from "./chart-theme";
import { pctText, type Describe } from "../kpis";

export function TrendLine({ lineData, topZips, describe }: {
  lineData: Array<Record<string, unknown>>;
  topZips: string[];
  describe: Describe;
}) {
  return (
    <ChartCard
      title="Avg price drop % by ZIP — last 30 days"
      caption="One point per ZIP per daily load — a missing day is a missed ingest, detailed in the card above."
      summary={describe(
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
  );
}
