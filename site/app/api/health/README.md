# site/app/api/health/ — `GET /api/health`

**What lives here.** `route.ts` — ingestion health from `pipeline_runs` +
snapshot coverage: run counts, `coverage_pct`, `next_run_at` (cron maths from
`lib/cron.ts`). Feeds the `IngestionHealth` card on `/trends` and `/data`.

**The one trap.** Two coverage-percent rounding rules exist **on purpose** and
must not be merged: this API's `coverage_pct` always rounds to exactly 1
decimal (`pct1FromRatio`), while the prose disclosure (`market.coverageNote`
via `fmtPct(…, "adaptive")`) switches to whole numbers ≥10 %. Merging them
changes rendered text on the live site (decisions.md §8).

**Detail.** `route.ts` T0 header. DB failure → frozen fallback (`live:false`).
