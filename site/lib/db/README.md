# site/lib/db/ — the server-only SQL path (split out of `lib/db.ts`, formerly a single file)

**What lives here.**

- `connection.ts` — `getSql()`: the Neon (postgres-js) connection factory.
  **Server-only** — must never be imported by a client component.
- `queries.ts` — the SQL constants every `/api/*` route runs verbatim
  (`ZIPS_QUERY`, `META_*`, `LISTING_HISTORY_QUERY`, `HEALTH_QUERY`).
- `deals-query.ts` — `buildDealsQuery()`, the one dynamic builder compiling a
  `DealQuery` into a parameterised SELECT over `vw_latest_listings`, including
  the recency guard on `max(snapshot_date)`.

**The one trap.** The recency guard's `window_days` clamp is deliberately
**not** a bind parameter (constant folding against `max(snapshot_date)` —
commented at the site). Also: this directory is imported only from
`app/api/*`; a component importing it drags server code into the client bundle.

**Detail.** Each file's T0 header; why the guard uses `max(snapshot_date)` and
never `CURRENT_DATE`: [docs/decisions.md](../../../docs/decisions.md) §3.
