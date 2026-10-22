# site/lib/ — shared client/server library code

**What lives here.**

| File | Owns |
|---|---|
| `api-types.ts` | the API contract types (`Deal`, `Meta`, `Health`, …) mirroring the views |
| `filters.ts` | `FilterState`, defaults, pure `applyFilters` |
| `scores.ts` | `SCORES`, `SCORE_COLORS`, pill inks — the score identity in one place |
| `format.ts` | `fmtMoney`, `fmtPct` (two rounding rules, parameterised), `fmtCount`, `parseNum` |
| `dates.ts` | `maxSnapshotDate`, `listingKey`, `daysSince`, carried-over badges |
| `market.ts` | `MARKET_REFERENCE` (22,801) + the coverage disclosure wording |
| `cron.ts` | `CRON_SCHEDULE` + `nextRunAt` (outside `app/api/*` because route modules restrict exports) |
| `fallback.ts` | the frozen-CSV reader (`live:false` data source) |
| `shortlist.ts` · `reductions.ts` · `stats.ts` · `site-config.ts` | localStorage shortlist · price-reduction derivation · mean/median · the one `SITE_ORIGIN` |
| `useFilters.ts` · `useUrlSearch.ts` | the URL-backed filter store + the `useSyncExternalStore` query-string reader (the CLS fix) |
| `db/` | server-only SQL path (see its own README) |

**The one trap.** This layer is **deliberately parameterised where call sites
used to disagree** — the two coverage-percent rules, the newest-date rules
(`maxSnapshotDate` vs `/api/meta`'s `deals[0]`) — see
[docs/decisions.md](../../docs/decisions.md) §8. New code calls these helpers;
it does not re-derive the maths.

**Detail.** Each file's T0 header.
