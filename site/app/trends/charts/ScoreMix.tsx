"use client";
// WHAT:     the /trends "Motivation mix" donut chart (High / Medium / Low).
// WHY:      split verbatim out of the old 493-line app/trends/page.tsx
//           (REFACTOR_PLAN §5 Phase 3), including the rootTabIndex=-1 gate fix
//           and the legend-contrast S4 fix that came with it.
// INPUTS:   mix + total (share denominator = deals.length) from the shell,
//           describe from kpis.ts.
// OUTPUTS:  the ChartCard section.
// CALLERS:  app/trends/page.tsx.

import {
  Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip,
} from "recharts";
import { SCORES, SCORE_COLORS } from "@/lib/scores";
import type { MotivationScore } from "@/lib/api-types";
import { ChartCard, legendLabel } from "./ChartCard";
import { TIP } from "./chart-theme";
import { pctText, type Describe } from "../kpis";

export function ScoreMix({ mix, total, describe }: {
  mix: Array<{ name: string; value: number }>;
  total: number;
  describe: Describe;
}) {
  return (
    <ChartCard
      title="Motivation mix"
      caption="Share of High / Medium / Low in the current filter."
      summary={describe(
        "Motivation mix",
        mix.map((m) => `${m.name} ${m.value} listings (${pctText(total > 0 ? (m.value / total) * 100 : null)})`)
      )}
    >
      <ResponsiveContainer>
        <PieChart>
          {/* Gate fix (aria-hidden-focus) — recharts defaults `rootTabIndex`
              to 0, so the pie's root <g> stayed keyboard-focusable inside the
              `aria-hidden` wrapper above. That is `aria-hidden-focus`
              (serious) rather than the `svg-img-alt` it replaced, and it was
              also the page's one unnamed control. -1 makes it
              programmatically focusable but not tabbable; nothing is lost,
              because the sr-only summary is the chart's accessible form.
              Verified by: NOTHING (gap) — no key re-runs axe or the tab-stop
              walk on the pie; nothing here was re-measured at runtime. */}
          <Pie rootTabIndex={-1} data={mix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
            {mix.map((m) => (
              <Cell key={m.name} fill={SCORE_COLORS[m.name as MotivationScore]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TIP} />
          <Legend wrapperStyle={{ color: "#d4d4d8" }} formatter={legendLabel} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
