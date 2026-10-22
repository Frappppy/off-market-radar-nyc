// WHAT:     the two pure summary stats the site computes anywhere — arithmetic
//           `mean` and `median` over number arrays.
// WHY:      both lived as module-locals inside app/trends/page.tsx (493 lines,
//           REFACTOR_PLAN §5 Phase 3); the computed overview (D3) needs the
//           same median, so one implementation lives here.
// INPUTS:   number arrays (nulls already filtered by the caller, as before).
// OUTPUTS:  number | null — null for an empty input, exactly as the original
//           helpers behaved. Verified by: TS — both signatures return
//           number | null, and the empty-array branch is the null source.
// CALLERS:  app/trends/{kpis,derivations}.ts, components/status/InsightCards.

export const mean = (xs: number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
