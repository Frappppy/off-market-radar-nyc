# site/app/api/deals/ — `GET /api/deals` (the data backbone)

**What lives here.** `route.ts` — compiles the query-string filters into a
parameterised SELECT via `lib/db/deals-query.ts::buildDealsQuery`, or the same
query as CSV (`Content-Disposition: attachment`, ≤5000 rows) when `format=csv`.
Payload: `{deals, live, count, window_days, latest_snapshot_date}`; DB failure
→ frozen-CSV fallback with `live:false`.

**The one trap.** The **recency guard**: the query anchors on the dataset's own
`max(snapshot_date)`, never `CURRENT_DATE` — one missed cron must not blank the
map (decisions.md §3, assertion G of `scripts/tier1_migration_check.py`). The
clamp around the `window_days` int is deliberately *not* parameterised (a
constant-folding choice, commented at the site) — don't "fix" it into a bind
parameter without re-measuring the query plan.

**Detail.** `route.ts` T0 header; the SQL itself: `lib/db/deals-query.ts`.
