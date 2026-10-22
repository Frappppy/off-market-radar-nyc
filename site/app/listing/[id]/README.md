# site/app/listing/[id]/ — `/listing/[id]` (shareable property page)

**What lives here.** `layout.tsx` — a thin **server** layout whose
`generateMetadata` names the listing id (client pages can't export
`metadata`); `page.tsx` — the client page: header facts, price history +
sparkline, reductions, shortlist toggle. Data: `/api/listing/[id]` via
`hooks/useListingHistory.ts`, plus a filter-independent `useDeals` query so the
page renders even when shared without query params.

**The one trap.** The sitemap enumerates **only the 82 fallback-CSV ids** for
this route — no `DATABASE_URL` exists at build time, so live-DB ids can't be
listed; they stay discoverable through SideCard's "Open full page →" links.
Don't "fix" the sitemap by hardcoding ids (full reasoning in `app/sitemap.ts`).

**Detail.** Both files' T0 headers; runtime evidence in `site/shots/
listing-{390,1280}.png` + `phase3-runtime-gate.json`.
