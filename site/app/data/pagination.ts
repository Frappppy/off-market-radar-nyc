// WHAT:     the /data pager — page size, the validated sort/dir/page URL
//           readers, and the pure builder that turns a view patch into the
//           query string the address bar gets.
// WHY:      view state lives in the URL (roadmap 1.3, defect D3): a shared
//           link has to reproduce "sorted by DOM desc, page 3", not only the
//           filters. The 402-line app/data/page.tsx held all of it inline;
//           splitting it out (REFACTOR_PLAN §5 Phase 3) keeps every parse and
//           write byte-identical — defaults are DELETED rather than written,
//           so a shared link stays minimal.
// INPUTS:   the current search params + a partial view patch {sort, dir, page}.
// OUTPUTS:  PAGE (25 rows per view), parseDir/parsePage (garbage-tolerant URL
//           readers), buildViewSearch (the new query string, "" when nothing
//           but defaults remains).
// CALLERS:  app/data/page.tsx.

import { DEFAULT_DIR, DEFAULT_SORT, type SortKey } from "./columns";

export const PAGE = 25;

export const parseDir = (v: string | null): 1 | -1 => (v === "-1" ? -1 : 1);

// 1-based, matching the "Page N of M" the user reads in the paginator, so a
// copied link says the same thing as the screen. Garbage, 0 and negatives all
// fall back to page 1 rather than an empty table.
// Verified by: NOTHING (gap) — nothing feeds a garbage/0/negative `page` and
//   asserts the pager lands on page 1.
export const parsePage = (v: string | null): number =>
  v != null && /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : 1;

export interface ViewPatch {
  sort?: SortKey;
  dir?: 1 | -1;
  page?: number;
}

// Same style as useFilters: replace (no history spam), never scroll. Default
// values are deleted rather than written, so a shared link stays minimal.
// (`page <= 1` deletes too — page 1 IS the default, and `?page=1` was never
// written.)
// Verified by: NOTHING (gap) — no check inspects the address bar after a
//   sort/page write to assert defaults were deleted.
export function buildViewSearch(sp: URLSearchParams, patch: ViewPatch): string {
  const p = new URLSearchParams(sp.toString());
  if (patch.sort !== undefined) {
    if (patch.sort === DEFAULT_SORT) p.delete("sort");
    else p.set("sort", patch.sort);
  }
  if (patch.dir !== undefined) {
    if (patch.dir === DEFAULT_DIR) p.delete("dir");
    else p.set("dir", String(patch.dir));
  }
  if (patch.page !== undefined) {
    if (patch.page <= 1) p.delete("page");
    else p.set("page", String(patch.page));
  }
  return p.toString();
}
