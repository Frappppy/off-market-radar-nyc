# Stage 3 verification — full-harvest-20261023

- run: `full-harvest-20261023` · status `success` · scraped 22577 · loaded 22317
- database size: 29 MB

## Tables
- `listings`: 22452 rows (22448 active)
- `listing_snapshots`: 24399 rows

| snapshot_date | rows |
|---|---|
| 2026-10-15 | 82 |
| 2026-10-16 | 1011 |
| 2026-10-20 | 989 |
| 2026-10-23 | 22317 |

## Views (dashboard/views.sql applied)
- `vw_latest_listings`: 22452
- `vw_listing_history`: 24399
- `vw_zip_price_drop_30d`: 546

| motivation_score | listings |
|---|---|
| Low | 11860 |
| Medium | 8746 |
| High | 1846 |

## Recent pipeline runs
| run_id | status | loaded |
|---|---|---|
| full-harvest-20261023 | success | 22317 |
| 20261020-145403 | success | 989 |
| 20261016-055515 | success | 1011 |
| neon-prod-load-20261016 | success | 82 |

## Notes
- The load added 22317 listings. `vw_latest_listings` shows 22452, i.e. 135 rows left over from the earlier daily runs (2026-10-15/16/20) that were not in this harvest; they stay visible until they miss 3 consecutive successful runs.
- Score counts here differ from the Parquet by those leftover rows only (135 total).
- One snapshot date per run is expected: this was a one-off full harvest, not a daily run, so the 30-day trend view has a single point for 2026-10-23.
