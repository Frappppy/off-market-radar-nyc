# site/hooks/ — the three fetch hooks (one per endpoint)

**What lives here.**

- `useDeals.ts` — **the one** `/api/deals` request path (was 5 duplicated
  fetch effects with 2 different guard styles). Abort-based staleness: a
  response for a superseded query is dropped, not rendered.
- `useMeta.ts` — **the one** `/api/meta` path (was 4 copies).
- `useListingHistory.ts` — **the one** `/api/listing/[id]` path (SideCard +
  `/listing/[id]`).

**The one trap.** Every consumer must respect the hooks' **`ready`/abort
convention** — never render "0 listings" from a not-yet-loaded state (the
"0 listings shown" bug) and never fire a second, parallel fetch from a
component (the exactly-one-`/api/deals`-per-load gate result). Deliberate
non-preservation documented in `useDeals.ts`'s header: unmounting now aborts
in-flight requests instead of letting them complete into a no-op setState.

**Detail.** Each hook's T0 header. `useFilters`/`useUrlSearch` live in
`lib/` (they are state, not fetches).
