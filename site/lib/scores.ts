// WHAT: the motivation-score identity in one place — the ordered score list
//   (SCORES), the colour palette (SCORE_COLORS), the pill foreground inks
//   (SCORE_PILL_TEXT) and the table sort rank (SCORE_RANK).
// WHY: copies lived in Filters, Explorer, useFilters, /data, /trends, lib/db,
//   lib/fallback, app/api/deals and opengraph-image — REFACTOR_PLAN §5 Phase 1.
// INPUTS: none — pure constants; the MotivationScore type stays in lib/api-types.ts
//   (the API contract), and this module only imports it, type-only.
// OUTPUTS: SCORES (readonly, High->Medium->Low = display and sort order),
//   SCORE_COLORS / SCORE_PILL_TEXT (hex per score), SCORE_RANK (0/1/2).
// CALLERS: components/{Filters,Explorer,SideCard,DealMap}, lib/{useFilters,
//   fallback, db}, app/{data, trends}, app/api/deals, app/opengraph-image.
//
// The three hues are ALSO CSS custom properties --high/--medium/--low in
// app/globals.css — CSS cannot import TypeScript, so the mirror is deliberate
// and the globals.css block carries the matching cross-reference comment.

import type { MotivationScore } from "./api-types";

export const SCORES = ["High", "Medium", "Low"] as const;

export const SCORE_COLORS: Record<MotivationScore, string> = {
  High: "#d62728",
  Medium: "#e6a817",
  Low: "#9aa0a6",
};

// S4 — the pill is the one place a motivation token is used as a BACKGROUND
// behind text, so it needs its own foreground. `text-white` (what every pill
// used to hardcode) measured #ffffff on #e6a817 = 2.10:1 — the worst pair in
// the QA report. Dark ink on that same amber background measures 9.45:1, so
// the brand amber is kept exactly as-is and
// only the label colour changes. High keeps white (5.02:1); dark ink on
// #d62728 would be 3.96:1 and would fail. Low's #9aa0a6 takes dark ink too
// (7.5:1) — white on it was 2.64:1, which the report missed because the
// default filter (High+Medium) never renders a Low pill. The three hues stay
// distinct, so the score is still readable at a glance.
// Verified by: NOTHING (gap) — the contrast ratios are QA-report numbers,
//   never re-measured at runtime.
export const SCORE_PILL_TEXT: Record<MotivationScore, string> = {
  High: "#ffffff",
  Medium: "#09090b",
  Low: "#09090b",
};

/** Sort rank for the /data table's default sort (High first). The `?? 9` at
 *  the call site keeps unknown scores sorted last, as before. */
export const SCORE_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
