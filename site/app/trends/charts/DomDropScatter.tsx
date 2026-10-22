"use client";
// WHAT:     the /trends "DOM vs price drop — every listing" scatter chart.
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3) — full-width tile, score-coloured
//           points, same summary enumeration over SCORES.
// INPUTS:   scatter from deriveCharts (DOM vs drop per listing), describe
//           from kpis.ts.
// OUTPUTS:  the span-wide ChartCard section.
// CALLERS:  app/trends/page.tsx.

import {
  CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { SCORES, SCORE_COLORS } from "@/lib/scores";
import type { MotivationScore } from "@/lib/api-types";
import { ChartCard } from "./ChartCard";
import { GRID, TICK, TIP } from "./chart-theme";
import type { Describe } from "../kpis";

export function DomDropScatter({ scatter, describe }: {
  scatter: Array<{ dom: number; drop: number; score: MotivationScore }>;
  describe: Describe;
}) {
  return (
    <ChartCard
      span
      title="DOM vs price drop — every listing"
      caption="Top-right is the strike zone: stale AND cutting. Color = motivation score."
      summary={describe(
        "Days on market versus price drop, coloured by motivation score",
        SCORES.map(
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
  );
}
