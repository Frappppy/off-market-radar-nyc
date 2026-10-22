# site/app/trends/ — `/trends` (market analytics)

**What lives here.** `page.tsx` — the client shell (KPIs, `IngestionHealth`,
charts grid, top-10 table); `kpis.ts` — KPI derivation; `derivations.ts` —
the chart-facing `useMemo`s; `top-deals.tsx` — the top-10 table component;
`charts/` — one component per chart. Data: `/api/zips` (filter-independent)
+ `/api/deals` (filter-aware, with a staleness guard).

**The one trap.** This was the route where the **stale-response race** was
found: `/api/deals` responses must be dropped if they no longer match the
current query (the guard lives in `hooks/useDeals.ts`; this page must keep its
`ready`/abort handling). Every chart's data is also rendered as `sr-only` text
for accessibility — keep that when touching a chart.

**Detail.** Each file's T0 header; gate numbers: `jobs/tier1-gate-fixes/
evidence/gate-fixes.md` (six consecutive deep-link loads → 43 rows, one
request each).
