# site/components/ — client components, in five themed subdirectories

**What lives here.** Every component is a `"use client"` module, grouped by
theme (they used to sit flat in this directory — imports now carry the
subdirectory):

| Dir | Components |
|---|---|
| `explorer/` | `Explorer` (dispatcher), `CompactExplorer`, `FullExplorer` |
| `listings/` | `SideCard`, `DealMap`, `PriceSparkline`, `PriceHistoryBlock`, `ScorePill` |
| `filters/` | `Filters`, `FilterNav`, `FilterNotices`, `ShareLink` |
| `status/` | `IngestionHealth`, `Freshness`, `HeroStats`, `InsightCards` |
| `ui/` | `HScroll` (+ future primitives) |

**The one trap.** Shared data fetching lives in `hooks/`, not in components —
a component that starts its own `fetch("/api/…")` reintroduces the duplication
phase 1 killed (5 deals-fetches → `useDeals`, 4 meta-fetches → `useMeta`). The
exception, documented in place: `IngestionHealth` keeps its own `/api/health`
fetch (different endpoint/payload).

**Detail.** Each subdirectory README + each component's T0 header.
