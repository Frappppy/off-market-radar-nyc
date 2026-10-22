# site/app/api/zips/ — `GET /api/zips`

**What lives here.** `route.ts` — per-ZIP daily trends from
`vw_zip_price_drop_30d` (`ZIPS_QUERY`): `[{zip, snapshot_date,
avg_price_drop_pct, listing_count}]`. Filter-independent on purpose — `/trends`
shows the whole market regardless of map filters.

**The one trap.** The **fallback trends are honestly demo-only**: the frozen
82-row CSV is a single snapshot date, so a `live:false` render shows one point
per ZIP. The route's T0 header states this; the UI must not present fallback
trends as a live multi-day series.

**Detail.** `route.ts` T0 header.
