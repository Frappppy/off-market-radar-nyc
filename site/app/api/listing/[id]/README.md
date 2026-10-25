# site/app/api/listing/[id]/ — `GET /api/listing/[id]`

**What lives here.** `route.ts` — one listing, read twice from the same
`(source, listing_id)` key and settled independently: its current row from
`vw_latest_listings` (`LISTING_DETAIL_QUERY`, one scalar subquery for the
dataset's newest snapshot) and its daily series from `vw_listing_history`
(`LISTING_HISTORY_QUERY`), oldest-first. Both feed the standalone
`/listing/[id]` page and the SideCard's panel + sparkline through
`hooks/useListingHistory`.
Shape: `{live, source, listing_id, deal, dataset_latest_snapshot_date, history:
[…], latest_snapshot_date, unavailable?}`.

**The one trap.** Three distinct failure modes, all deliberate — and each half
degrades on its own terms: **bad id** → `400`; **row unreadable** → answer from
the frozen CSV with `live:false`; **series unreadable** → `200` with
`unavailable:true`. `live` describes the ROW only, so a listing whose row came
from live SQL over a not-yet-granted history view is still `live:true` — saying
otherwise would tell the reader the address and price were sample data when they
were not. A generic `try { … } catch { 500 }`, or one shared `Promise.all`, here
would either break the site's never-an-error-page promise (I14) or throw away
the row the moment the series fails.

**Detail.** `route.ts` T0 header. Migration proof for the backing view:
`docs/apply_tier1_migration.md` (assertion F).
