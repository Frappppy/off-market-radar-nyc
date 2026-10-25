# Site copy + docs refresh after the full harvest — 2026-10-25

**Why.** The 2026-10-23 full harvest took the dataset from a ~1k daily sample to
22,317 rows, and the next daily run (2026-10-24) put the *newest cohort* back to
1,017. Every surface that said "sample", "capped on purpose" or "4.4%" was then
either wrong or misleading. This pass fixes the copy and the docs, and changes no
behaviour: no query, no scoring rule, no view.

## What the database actually holds when this was written

Read as the owner role (`config/database.local.env`), 2026-10-25:

| | value |
|---|---|
| `listings` | 22,492 (22,420 active) |
| `listing_snapshots` | 25,416 over **5** dates (10-15/16/20/23/24) |
| newest cohort (`max(snapshot_date)`, 2026-10-24) | **1,017** |
| 2026-10-23 harvest snapshot | **22,317** |
| `vw_latest_listings` | 22,492 |
| `vw_zip_price_drop_30d` | 699 |
| score mix in the view | 1,848 High / 8,746 Medium / 11,898 Low |
| newest cohort High | 76 |
| database size | 29 MB |

`/api/meta` and `/api/health` against the local dev server agreed exactly:
`total_tracked 1017`, `high_count 76`, `total_ever_tracked 22492`,
`coverage_pct 4.5`, `snapshot_days 5`.

**The trap this pass exists to document:** the site's headline number is the
newest cohort (1,017), not the ledger (22,492). The harvest did not vanish — the
daily cron replaced the newest snapshot. Every doc now states the two separately.

## Copy changes (`site/`)

| file | before | after |
|---|---|---|
| `components/status/HeroStats.tsx` | eyebrow "sample snapshot"; h1 "… in NYC this week"; "Sample scope: a capped … scan … not full coverage" | "daily snapshot"; "… in NYC"; "Coverage: a robots-respecting scan of ~22.8k Zillow NYC actives, refreshed daily" |
| `components/status/InsightCards.tsx` | card titled "Capped on purpose, not broken", body "this is a sample of NYC actives rather than full-market coverage" | "How complete this is", "coverage is near-complete for Zillow actives but not guaranteed exhaustive" + "the High count is a floor, not a ceiling" |
| `components/status/IngestionHealth.tsx` | "Today's scan (sample)", "— a sample", "Not full coverage … capped by design" | "Today's scan", coverage share with no "sample" qualifier, "a small share of the market is always missing" |
| `components/status/Freshness.tsx` | "1,017 tracked today (sample)" | "1,017 tracked today" |
| `app/data/export-header.tsx` | "Sample data: … so this is a slice of the market" | "Coverage: a robots-respecting Zillow scan … a small share is always missing" |
| `app/layout.tsx` (footer) | "A sample of NYC actives, not full-market coverage" | "Covers nearly all Zillow NYC actives; production would use a licensed MLS feed for completeness" |
| `lib/market.ts`, `lib/fallback.ts` | comments describing the note as a small-sample disclosure | comments state it must read correctly at 4.5% **and** 97.9%, and that the 82-row CSV is the offline fallback only |

No string was changed in a way that adds a live number to a fixed-height block:
the hero paragraph stays data-independent, which is the F2 CLS rule from
`jobs/tier1-gate-fixes/evidence/gate-fixes.md` §11.

## Doc changes

- `README.md` — "Live data reality" rewritten around the cohort-vs-ledger split
  (ledger 22,492 / cohort 1,017 / harvest 22,317, five runs, 699 zip-days, score
  mix, 7,058 rows with `price_drop_pct`); compliance section gained the one-off
  harvest bullet and no longer claims every run samples ~5%; stage 2 documents
  `--sanitize`; verification table updated; test count 164+2 skipped → **178
  passed**.
- `ARCHITECTURE.md` — same test-count correction in both places.
- `docs/roadmap.md` — new "Full-market harvest" subsection with a three-column
  table (2026-10-16 / harvest / now) that makes the regression of the headline
  number explicit rather than surprising.
- `jobs/README.md` — `full-harvest-20261023/` added to the cited-evidence
  keep-list; folder/file counts refreshed.
- `requirements.txt` — `playwright==1.64.0` added. `src/scrape/browser.py`
  imports it at module load, and `tests/test_harvest.py` imports that module, so
  without the pin the documented conda env cannot even collect the suite.

## Verification

```
site/   npm run typecheck                     -> clean (tsc --noEmit)
repo    pytest -q (conda env)                 -> 178 passed in 0.89s
repo    dashboard/verify_contract.py          -> 54/54, exit 0
```

Browser pass: Chromium 1248 launched with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, dev server
on `:3113` against Neon as `offmarket_reader`.

| route | 390 | 1280 | console errors | failed requests |
|---|---|---|---|---|
| `/` | `coverage-copy-home-390.png` | `coverage-copy-home-1280.png` | 0 | 0 |
| `/data` | `coverage-copy-data-390.png` | `coverage-copy-data-1280.png` | 0 | 0 |
| `/trends` | `coverage-copy-trends-390.png` | `coverage-copy-trends-1280.png` | 0 | 0 |

Screenshots are in `site/shots/`. Rendered strings confirmed from the DOM, not
from the source: `h1` = "76 motivated sellers in NYC", eyebrow =
"NYC · DAILY SNAPSHOT · LIVE FROM NEON".

### Two environment notes, not defects

1. **WebGL.** The browsers the MCP servers launch here have GL disabled, so
   `maplibregl.Map` throws `Could not create a WebGL context`, React unmounts the
   page, and the dev overlay covers the screenshot. Launching Chromium with
   SwiftShader fixes it — which is what the pass above did, and why the map is
   visible in the shots.
2. **"N" badge.** The circular "N" that appears mid-page in the full-page
   screenshots is the Next.js 15 dev-tools indicator (fixed to the viewport
   bottom-left, so page stitching places it oddly). It does not exist in a
   production build.

## Not done, deliberately

- Nothing committed or pushed. The copy changes ride with the still-uncommitted
  clean-stage work.
- No production deploy from this pass; the live site still serves the previous
  copy until the next push or `vercel deploy`.
- `--details motivated` was not run, so the 68% of rows without
  `price_drop_pct` are unchanged. That is the cheapest next win for the High
  count and needs no extra search requests.
