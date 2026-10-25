// WHAT:     the two row-count caps that /api/deals enforces — the default page
//           size (500) and the hard export/SQL ceiling (5000).
// WHY:      the number 5000 was written in three places (the route's
//           `wantCsv ? 5000 : limit` override, the SQL LIMIT clamp, and the
//           fallback slice) and 500 in two, while app/data said the CSV is
//           "exactly these N rows" about a cohort the server had just silently
//           re-capped. One module makes the cap a named rule the UI can quote,
//           so a claim about the export and the export itself cannot disagree.
// INPUTS:   none — pure constants.
// OUTPUTS:  PAGE_LIMIT_DEFAULT (500) · EXPORT_LIMIT (5000) · clampLimit() —
//           the one clamp every caller runs a supplied limit through.
// CALLERS:  app/api/deals/route.ts, lib/db/deals-query.ts,
//           app/data/export-header.tsx.
// Verified by: TS — clampLimit takes a number and every caller quotes these
//   constants instead of a literal; nothing re-measures the caps at runtime.

/** The cohort size a page asks for when it does not say otherwise. */
export const PAGE_LIMIT_DEFAULT = 500;

/** The hard ceiling: one CSV export, one SQL LIMIT, one fallback slice. */
export const EXPORT_LIMIT = 5000;

/**
 * Clamp a caller-supplied limit into the range the API actually serves.
 * A non-finite value (what `Number("abc")` yields) is NOT read as "no limit" —
 * it falls back to the page default, so a typo in a shared link can never turn
 * into an unintended 5,000-row request.
 */
export const clampLimit = (n: number, max: number = EXPORT_LIMIT): number => {
  const value = Number.isFinite(n) ? Math.floor(n) : PAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(value, 1), max);
};
