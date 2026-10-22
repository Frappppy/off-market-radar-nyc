# site/components/status/ — freshness, health and overview cards

**What lives here.**

- `IngestionHealth.tsx` — the run/coverage card (`/trends`, `/data`); keeps its
  own `/api/health` fetch (documented exception to the hooks rule).
- `Freshness.tsx` — the header "data as of" strip; its frozen (`live:false`)
  state folds into a single pill below `lg` (the CLS fix — see below).
- `HeroStats.tsx` — the `/` hero + KPI row (via `useDeals`/`useMeta`).
- `InsightCards.tsx` — the computed overview cards on `/` (replaced the three
  hardcoded ones; filter-responsive with loading/error/empty states).

**The one trap.** The header row is CLS-fragile by geometry: `Freshness` is
78 px loading / 118 px live / ~464 px with its detail line, and the header's
first row budgets 135 px at 390 — so the frozen state folds into one pill and
the wrapper is `max-w-[130px] truncate`. Preserve those constraints or the
layout-shift regression comes straight back (measured pre-fix: 0.1466 / 0.317;
post-fix: ≤0.002). Evidence: `jobs/tier1-gate-fixes/evidence/gate-fixes.md` §11.
