# site/app/api/listing/[id]/ — `GET /api/listing/[id]`

**What lives here.** `route.ts` — one listing's full price history from
`vw_listing_history` (`LISTING_HISTORY_QUERY`), oldest-first; feeds the
SideCard panel, the sparkline, and the standalone `/listing/[id]` page.
Shape: `{live, source, listing_id, points: [...]}`.

**The one trap.** Three distinct failure modes, all deliberate: **bad id** →
`400`; **DB error** → `200` with `{live:false, unavailable:true}` (the page
still renders the rest of the listing, honest about the missing history);
**ok** → `live:true`. A generic `try { … } catch { 500 }` here would break the
site's never-an-error-page promise (I14).

**Detail.** `route.ts` T0 header. Migration proof for the backing view:
`docs/apply_tier1_migration.md` (assertion F).
