# site/components/listings/ — per-listing presentation

**What lives here.**

- `SideCard.tsx` — the property dialog (map pin / table row): facts, reductions,
  history block, "Open full page →", shortlist toggle.
- `DealMap.tsx` — MapLibre + supercluster pins (keyboard-operable).
- `PriceSparkline.tsx` — hand-rolled inline-SVG sparkline (no chart lib).
- `PriceHistoryBlock.tsx` — the history series + reductions (used by SideCard
  and `/listing/[id]`).
- `ScorePill.tsx` — the one score-pill markup (it used to exist three times).

**The one trap.** The shortlist is **browser-local** (`lib/shortlist.ts`,
localStorage) — never render it from server data, and never assume another
tab's state. Row identity everywhere is the composite `listingKey`
(`source:listing_id` from `lib/dates.ts`); a bare `listing_id` will collide
across sources.

**Detail.** Each component's T0 header.
