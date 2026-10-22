# site/app/ — routes (pages + APIs) and global chrome

**What lives here.**

| Path | Route |
|---|---|
| `page.tsx` + `layout.tsx` | `/` — computed overview (hero KPIs, compact explorer, `InsightCards`); root layout = header/nav/freshness/footer + global metadata |
| `map/` | `/map` — full explorer (metadata-only `layout.tsx` + `<Explorer variant="full" />`) |
| `trends/` | `/trends` — shell + `kpis.ts` + `derivations.ts` + `top-deals.tsx` + `charts/` (7 charts) |
| `data/` | `/data` — shell + `columns.ts` + `pagination.ts` + `deals-table.tsx` + `export-header.tsx` |
| `listing/[id]/` | `/listing/[id]` — shareable property page (server layout for metadata + client page) |
| `api/` | the five JSON/CSV endpoints |
| `globals.css` · `icon.svg` · `opengraph-image.tsx` · `robots.ts` · `sitemap.ts` | tokens/chrome/SEO |

**The one trap.** The `map/ trends/ data/ listing/[id]/` `layout.tsx` files are
**metadata-only shims** — client pages can't export `metadata`. If a page 404s
or loses its title, check you didn't merge the shim into the client page.

**Detail.** Each route file's T0 header. Client-filter semantics:
`lib/filters.ts` + `lib/useFilters.ts` (empty-vs-absent URL params).
