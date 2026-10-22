# site/app/trends/charts/ — one component per chart

**What lives here.** Seven Recharts components — `TrendLine`, `ZipBar`,
`ScoreMix`, `DomHistogram`, `PriceBands`, `SqftByType`, `DomDropScatter` —
plus `ChartCard.tsx` (the shared card shell: title, empty state, sr-only data
text) and `chart-theme.ts` (the shared palette/axis tokens). Split from the
former 493-line `trends/page.tsx`.

**The one trap.** Every chart must convey its data twice: visually **and** as
`sr-only` text via `ChartCard` (axe found 78 `svg-img-alt` violations here
before this existed). A chart that only draws an SVG fails the accessibility
gate; evidence: `jobs/tier1-gate-fixes/evidence/gate-fixes.md`.

**Detail.** `chart-theme.ts` T0 header; colours come from `lib/scores.ts` /
Tailwind tokens — don't hardcode hex in a chart.
