# site/app/listing/ — route group for the shareable property page

**What lives here.** Only the `[id]/` segment — the dynamic `/listing/<id>`
route added in phase 3 (D3). Its own README: `[id]/README.md`.

**The one trap.** The `id` here is the composite `source:listing_id` **url-
encoded** (`zillow%3A145558321`), not the bare Zillow id — the page decodes it
before calling `/api/listing/[id]`. Links are produced by `lib/dates.ts
::listingKey` + `encodeURIComponent` in SideCard/"Open full page →".
