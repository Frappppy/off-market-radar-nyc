// WHAT:   the / (overview) page — hero, compact explorer, computed insights.
// WHY:    D3 — make the landing a genuinely computed overview: the three
//   insight cards used to be hardcoded claim strings that no filter and no
//   snapshot could contradict.
// INPUTS: none directly; the three children fetch their own data.
// OUTPUTS: the rendered overview (one h1, from HeroStats).
// CALLERS: the Next.js router (app/page.tsx route).
import Explorer from "@/components/explorer/Explorer";
import HeroStats from "@/components/status/HeroStats";
import InsightCards from "@/components/status/InsightCards";

// Map-first landing (owner decision): hero + mini explorer + insights.
// D3 — the three insight cards used to be hardcoded claim strings that no
// filter and no snapshot could contradict; InsightCards (client) computes them
// from the current filter cohort + /api/meta instead. HeroStats and the
// compact explorer stay exactly as they were.
// Verified by: shots/phase3-runtime-gate.json → home_insights.respondToFilters
//   (home_insights.default / scoreHigh_dom0 pin the rendered strings).
export default function Overview() {
  return (
    <div className="space-y-4">
      <HeroStats />
      <Explorer compact />
      <InsightCards />
    </div>
  );
}
