# site/components/explorer/ — the map explorer (split from one 245-line file)

**What lives here.**

- `Explorer.tsx` — the dispatcher: one Suspense boundary that picks
  `CompactExplorer` (home's inline version) or `FullExplorer` (`/map`) by
  variant prop.
- `CompactExplorer.tsx` / `FullExplorer.tsx` — the two shells: fetch deals +
  meta via `hooks/useDeals`/`useMeta`, compose `Filters`, the `DealMap`, the
  results count/notices and `SideCard`.

**The one trap.** The compact and full variants intentionally share *state
conventions*, not markup — divergent layouts are why they are two files. When
adding a filter, wire it through `useFilters` (one URL-backed store) rather
than local state, or deep links stop reproducing the view (the `/trends`
deep-link race was exactly this class of bug).

**Detail.** Each file's T0 header.
