// WHAT:     the client-side filter model — the FilterState shape, its defaults
//           and the pure in-memory `applyFilters` over Deal rows.
// WHY:      these three lived in lib/types.ts, an API-contract file, so the
//           filter MODEL read like part of the API — REFACTOR_PLAN §5 Phase 3.
//           The URL BINDING of this model (parsing params, router.replace,
//           disclosure notices) stays in lib/useFilters.ts; this module is the
//           pure half, so the server's frozen-CSV fallback can apply the same
//           rules without pulling in a hook.
// Verified by: /api/deals fallback parity — this applyFilters is the exact
//   rule the frozen-CSV path runs; TS keeps FilterState the shared model.
// INPUTS:   plain FilterState objects and Deal rows.
// OUTPUTS:  the filtered Deal[] — byte-identical semantics to the old
//           lib/types.ts implementation (same null-coercions, same ordering of
//           the checks).
// CALLERS:  app/api/deals (fallback path), lib/useFilters.ts, hooks and
//           components that read FilterState.

import type { Deal, MotivationScore } from "./api-types";

export interface FilterState {
  score: MotivationScore[]; // default [High, Medium]
  minDom: number; // default 60
  minPrice: number | null;
  maxPrice: number | null;
  type: string | null;
  zips: string[]; // multi-select
}

export const DEFAULT_FILTERS: FilterState = {
  score: ["High", "Medium"],
  minDom: 60,
  minPrice: null,
  maxPrice: null,
  type: null,
  zips: [],
};

export function applyFilters(deals: Deal[], f: FilterState): Deal[] {
  return deals.filter((d) => {
    if (!f.score.includes(d.motivation_score)) return false;
    if ((d.days_on_market ?? 0) < f.minDom) return false;
    if (f.minPrice != null && (d.price ?? Infinity) < f.minPrice) return false;
    if (f.maxPrice != null && (d.price ?? -Infinity) > f.maxPrice) return false;
    if (f.type && d.property_type !== f.type) return false;
    if (f.zips.length > 0 && !f.zips.includes(d.zip ?? "")) return false;
    return true;
  });
}
