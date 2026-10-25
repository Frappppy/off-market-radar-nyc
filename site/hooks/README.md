# site/hooks/ — the three fetch hooks (one per endpoint) + the range commit

**What lives here.**

- `useDeals.ts` — **the one** `/api/deals` request path (was 5 duplicated
  fetch effects with 2 different guard styles). Abort-based staleness: a
  response for a superseded query is dropped, not rendered.
- `useMeta.ts` — **the one** `/api/meta` path (was 4 copies). One module-level
  promise, so the landing page's four consumers transfer it once.
- `useListingHistory.ts` — **the one** `/api/listing/[id]` path (SideCard +
  `/listing/[id]`); it returns the listing's current row and its series from
  that single request, so the detail page makes exactly one data call.
- `useCommittedRange.ts` — not a fetch: defers a slider's value to the end of
  the interaction so a drag commits one URL write instead of ~36 fetches.

**The one trap.** Every consumer must respect the hooks' **`ready`/abort
convention** — never render "0 listings" from a not-yet-loaded state (the
"0 listings shown" bug) and never fire a second, parallel fetch from a
component (the exactly-one-`/api/deals`-per-load gate result). Deliberate
non-preservation documented in `useDeals.ts`'s header: unmounting now aborts
in-flight requests instead of letting them complete into a no-op setState.

**Detail.** Each hook's T0 header. `useFilters`/`useUrlSearch` live in
`lib/` (they are state, not fetches).
