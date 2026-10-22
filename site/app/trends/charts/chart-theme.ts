// WHAT:     the shared Recharts visual constants for /trends — axis tick ink,
//           tooltip chrome, grid stroke and the multi-series line palette.
// WHY:      they were module-locals in the old 493-line page.tsx; the seven
//           chart files under app/trends/charts/ share them verbatim
//           (REFACTOR_PLAN §5 Phase 3). No colour or size changed.
// INPUTS:   none — literals only.
// OUTPUTS:  LINE_COLORS, TICK, TIP, GRID.
// CALLERS:  app/trends/charts/*.tsx.

export const LINE_COLORS = ["#d62728", "#60a5fa", "#34d399", "#a78bfa", "#fbbf24", "#f472b6"];

export const TICK = { fill: "#a1a1aa", fontSize: 12 };

export const TIP = { background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5" };

export const GRID = "#3f3f46";
