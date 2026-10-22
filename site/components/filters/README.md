# site/components/filters/ — filtering + share controls

**What lives here.**

- `Filters.tsx` — the sidebar: score checkboxes, min-DOM/price range, ZIP/type.
- `FilterNav.tsx` — the header nav that **carries the query string** across
  routes (navigating by header must not reset the cohort).
- `FilterNotices.tsx` — the "we could not honour that param" disclosure list.
- `ShareLink.tsx` — copy-link control with a clipboard fallback.

**The one trap.** Filter state is **URL-backed with empty-vs-absent
semantics** (`lib/useFilters.ts`): `?score=` (present, empty) is not the same
as no `score` param. Any new control must round-trip through `useFilters` and
produce a `filterNotices` entry when it silently drops an unrecognised value —
a mistyped `?min_dom=abc` falling back to the frozen sample was a real bug.

**Detail.** `Filters` T0 headers; semantics: `lib/useFilters.ts` header.
