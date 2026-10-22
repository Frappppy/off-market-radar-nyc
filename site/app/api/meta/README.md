# site/app/api/meta/ — `GET /api/meta`

**What lives here.** `route.ts` — the header freshness strip: latest successful
run + latest snapshot date (`META_RUN_QUERY` / `META_SNAPSHOT_QUERY` in
`lib/db/queries.ts`). Filter-independent; consumed by `Freshness` and the
hooks' `useMeta`.

**The one trap.** Its fallback reads `deals[0]?.snapshot_date` **on purpose**
(the fallback rows arrive newest-first there), where every other consumer uses
`lib/dates.ts::maxSnapshotDate()`. Both are correct *for their input ordering* —
there is a NOTE block in `lib/dates.ts` explaining this; don't unify them
blindly (decisions.md §8).

**Detail.** `route.ts` T0 header. DB failure → frozen fallback (`live:false`).
