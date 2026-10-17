# QA report — populated price-history panel, fresh CLS, and the ingestion card
**Target:** `https://off-market-radar-nyc.vercel.app` (production, as deployed — no local build, no `vercel` command, no repo edits)
**Job:** `jobs/tier1-panel-verify/`
**Verdict in one line:** the populated per-listing price-history panel **does** render on production from both `/data` rows and real `/map` pin clicks, and it matches `/api/listing/<id>` field for field — that closes §9 items 1 and 7 of `jobs/tier1-ui-check/evidence/qa_report.md`. The fresh CLS numbers are worse than the old corrupted-session numbers suggested and are **not** shippable as-is: `/` and `/trends` fail the 0.1 bar at 1280, and `/trends` reaches **0.80 at 390** and **1.15 at 1350×940**. The 1.4 health card passes its regression check.

---

## 0. Verdict table

| # | Item | Verdict | One line |
|---|---|---|---|
| 1.1 | Populated history panel on `/data` (row click) | **VERIFIED** | `2 daily snapshots.`, real series, real reductions; dates/prices match the API exactly. |
| 1.2 | Populated history panel on `/map` (real coordinate click) | **VERIFIED** | Real `page.mouse.click` on a live 14×14 pin at zoom 12 opened the panel; Close works. **Closes §9 item 7.** |
| 1.3 | Sparkline draws sensibly | **VERIFIED, narrow** | `points="4.00,24.00 256.00,24.00"`, no `NaN`, 0 polygons, 1 end dot — correct for a flat series. No series with actual movement exists to test. |
| 1.4 | Panel content vs `/api/listing/455058452`, field by field | **VERIFIED** | Every date, price, %, DOM, $/sqft, ZIP and reason matches. |
| 1.5 | §9 item 7 — does a real pointer click open the panel in production? | **VERIFIED (yes)** | Real click opens it; a synthetic `.click()` also opens it, so the previous negative was a **measurement artefact**, not a prod difference. |
| 2.1 | Fresh CLS per route at 390 and 1280 | **MEASURED — site FAILS** | 1280: `/` 0.1988, `/trends` 0.4093 (fail); `/map` 0.0234, `/data` 0.0471 (pass). 390: `/` 0.2409, `/trends` 0.8002 (fail). |
| 2.2 | CLS culprits identified | **VERIFIED** | Same two culprits on every route: the `FOOTER` and the above-the-fold `DL`/`grid` blocks; on `/trends` the health card itself. |
| 2.3 | "Health card height constant (351 @1280 / 387 @390)" | **REFUTED on the numbers, PARTLY CONFIRMED on the mechanism** | Measured **156 @1280** and **357 @390**; the card's height is stable at 1280 but *moves 40–42px* anyway, and grows 333→357 during load at 390. |
| 3.1 | `/trends` + `/data` health card vs `/api/health`, field for field (1.4 regression) | **VERIFIED** | All five rows and the run id agree with the API, at both widths. |
| — | A 2-point series showing a real price **movement** | **COULD-NOT-VERIFY** | All 10 two-point listings in the default view are flat; 0 listings have ≥3 snapshots. |
| — | `/map` pin accessibility (`role`/`tabindex`/label) on production | **STILL FAILING** | Deployed pins are `role=null tabindex=null aria-label="Map marker"`, 14×14. The working tree already has the fix; **the builder has not redeployed**. |

Nothing here is rounded away: a partial is called partial, and every value below was measured on the deployed URL, not localhost.

---

## 1. Task 1 — the populated price-history panel (roadmap 1.2)

### 1.1 Target and why this target

The default `/data` view (`score=High,Medium&min_dom=60`) returned **133 rows**. I probed `/api/listing/<id>` for all 133:

| Snapshots in `history` | Listings |
|---|---|
| 1 | 123 |
| 2 | 10 |
| ≥3 | **0** |

**All ten two-point listings carry the *same* price on both snapshots** — there is no reachable series with actual price movement. The first two-point hit, probe #13, was `455058452`:

> `18-75 CORPORAL KENNEDY STREET #4A`, Bayside 11360, co-op, High, DOM 185, **$295,000**

```json
history: [
 { "snapshot_date": "2026-10-15", "price": 295000, "previous_price": 315000, "price_reduced": true,
   "days_on_market": 184, "price_per_sqft": 196.67, "price_drop_pct": 6.35, "motivation_score": "High",
   "motivation_reason": "DOM=184>90 AND drop=6.3%>5" },
 { "snapshot_date": "2026-10-16", "price": 295000, "previous_price": 315000, "price_reduced": true,
   "days_on_market": 185, "price_per_sqft": 196.67, "price_drop_pct": 6.35, "motivation_score": "High",
   "motivation_reason": "DOM=185>90 AND drop=6.3%>5" } ]
```

### 1.2 `/data` — the panel renders real data *(verified, [prod], 1280×900)*

Real mouse click on the row **cell** centre (hit-test returned the `TD`, not the Zillow link). Panel `aside[role="dialog"]`, `aria-label="Property detail for 18-75 CORPORAL KENNEDY STREET #4A"`, rendered text:

```
18-75 CORPORAL KENNEDY STREET #4A | Close | High | DOM 185 | drop 6.3% | co-op
PRICE HISTORY
2 daily snapshots.
$295,000 → $295,000 (oldest → newest snapshot)
RECORDED REDUCTIONS
2026-10-16 — $315,000 → $295,000 (−$20,000, −6.3%)
2026-10-15 — $315,000 → $295,000 (−$20,000, −6.3%)
Price $295,000 | $/sqft $197 | DOM 185 | ZIP 11360
Why DOM=185>90 AND drop=6.3%>5 | last seen today | View on Zillow ↗ | Add to shortlist
```

The old **"price history unavailable — the history view is not granted yet"** state is gone. Evidence: `evidence/panel-data-1280.png`, `evidence/panel-data-1280-rowvisible.png`, `evidence/panel-data-1280-recheck.png` (re-shot during this pass), `evidence/panel-data-390.png`.

**Field-by-field vs `/api/listing/455058452`:**

| Panel shows | API says | Match |
|---|---|---|
| `2 daily snapshots.` | `history.length === 2` | ✔ |
| `$295,000 → $295,000 (oldest → newest snapshot)` | oldest `price` 295000 → newest `price` 295000 | ✔ |
| `2026-10-16 — $315,000 → $295,000 (−$20,000, −6.3%)` | row 2026-10-16: `previous_price` 315000 → `price` 295000, `price_drop_pct` 6.35 | ✔ |
| `2026-10-15 — $315,000 → $295,000 (−$20,000, −6.3%)` | row 2026-10-15: `previous_price` 315000 → `price` 295000, `price_drop_pct` 6.35 | ✔ |
| `Price $295,000` | `price` 295000 | ✔ |
| `$/sqft $197` | `price_per_sqft` 196.67 | ✔ |
| `DOM 185` | newest `days_on_market` 185 | ✔ |
| `ZIP 11360` | listing ZIP | ✔ |
| `Why DOM=185>90 AND drop=6.3%>5` | `motivation_reason` (newest row) | ✔ |
| `High` · `drop 6.3%` · `co-op` | `motivation_score` High · `price_drop_pct` 6.35 | ✔ |

**Sparkline:** `viewBox="0 0 260 48"`, `polyline points="4.00,24.00 256.00,24.00"`, `hasNaN:false`, `0` `<polygon>`, `1` `<circle>`. Flat at mid-height (y = 24 = height/2) because oldest price == newest price; end dot at x=256. **No axis garbage, no NaN, no dashed "no data" placeholder** — the solid flat stroke plus end dot is the correct rendering of a flat two-point series.

### 1.3 Two content observations (not data errors, worth a look)

1. **`RECORDED REDUCTIONS` duplicates the same reduction on both snapshot dates.** The two rows are byte-identical (`$315,000 → $295,000`) because `previous_price` is repeated on *every* history row, and `reductionsFrom()` reads each row's own `previous_price`. A wholesaler reading "RECORDED REDUCTIONS" with two dated lines would reasonably conclude the seller cut twice. One real cut, two claims. Risk: **misleading**, not wrong-by-the-number.
2. **DOM history is not shown.** The two rows differ (`184` → `185`) and the panel shows only the newest. `2 daily snapshots.` is honest about depth, so this is a choice, not a bug — but the only real *change* in the series is the thing the panel does not plot.

### 1.4 `/map` — real coordinate click opens the populated panel *(verified, [prod], 1280×900)*

`/map?score=High%2CMedium&min_dom=60&zip=11360` (the `zip` filter is needed to get the target pin on screen). At zoom 10 the two 11360 listings collapse into **one untitled 28×28 cluster marker**; two real clicks on that marker split it into two titled 14×14 pins:

- `18-75 CORPORAL KENNEDY STREET #4A · High` at (834, 467)
- `2330 CORPORAL KENNEDY STREET #84 · High` at (743, 459)

`document.elementFromPoint(834,467)` returned the pin itself (`DIV.maplibre-pin.maplibregl-marker`), so I issued `page.mouse.click(834,467)` — **real CDP pointer input at coordinates, not a synthetic `.click()`**. The panel opened with the identical populated text as `/data` (same reductions, same `points="4.00,24.00 256.00,24.00"`, `hasNaN:false`, 0 polygons). A real click on **Close** closed it (`panel_closed_after_close: true`).

Evidence: `evidence/panel-map-1280-recheck.png` (this pass), `evidence/panel-map-1280.png`, `evidence/panel-map-390.png` (mobile, `pageSw 375 == pageCw 375`).

### 1.5 §9 item 7 answered: the "synthetic click" question

The deployed markers are wired as `el.onclick = …`, so a synthetic `element.click()` and a real pointer click reach the *same* listener. Measured in the earlier pass of this job:

| Test | Target | Result |
|---|---|---|
| A | `page.mouse.click(cx, cy)` on the live pin | panel **opens** |
| B | synthetic `element.click()` on the live, attached pin | panel **opens** |
| C | synthetic click on a reference captured *before* the 1.5s marker rebuild (`connectedAtClick:false`, `hasOnclick:true`) | panel **opens** |
| D | chrome-devtools actionability-gated click on the marker uid | **fails** — `The element did not become interactive within the configured timeout` |

The deployed map destroys and re-creates marker DOM on a **~1.5 s timer** (MutationObserver over 5004 ms on `.maplibregl-canvas-container`: 4 pins added, 4 removed, first removal at **1470 ms**). The previous report's "synthetic click did not open the panel in prod" was therefore an artefact of that churn plus a measurement method that waits for element stability — **not a production behaviour difference**. §9 item 7 is closed: a real pointer click opens the panel in production.

### 1.6 Console / network during Task 1 *(verified)*

| Run | Console errors/warnings | 4xx/5xx responses | Failed requests |
|---|---|---|---|
| `/data` + `/map` + panel open, fresh 1280 context | **0** | **0** | not instrumented in this run |
| `/map?score=High,Medium&min_dom=60` **and** `…&zip=11360`, load only | **0** | **0** | **0** (`requestfailed` listener attached) |
| `/map?…&zip=11360` cluster-split + pin click + Close | **0** | **0** | 4× CARTO vector tiles `net::ERR_ABORTED` — tiles cancelled by the zoom change, not errors |

`/api/listing/455058452?source=zillow` → 200 (measured earlier in this job).

**One transient worth recording, not attributed to the app:** a single `/map` run showed `2× Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR` plus `6× Error` in the console and rendered **zero** listing pins. It did not reproduce in the next two runs (0 console errors, 34 markers, 133 rows). I am not calling it a product defect, and I am not hiding it.

---

## 2. Task 2 — fresh CLS on the deployed site

### 2.1 How it was measured (stated once, so the numbers are quotable)

- Playwright chromium; `PerformanceObserver({type:'layout-shift', buffered:true})` installed via `context.addInitScript` **before** navigation.
- Standard **session-window** algorithm (5 s window, 1 s gap) → "max window"; raw sum also recorded.
- Cold navigation per route, **fresh browser context per case**, **no cache warming, no CPU or network throttling**, observation window 9–10 s after `load` (no shift lands later than ~3.0 s on any route).
- `/api/deals`, `/api/health` and `/api/meta` all returned `live: true` during the pass, so nothing measured is the frozen-fallback state.
- **No user input was dispatched in any run.** Injected listeners for `pointerdown`, `mousedown`, `touchstart`, `keydown`, `input` and `click` recorded **zero events**.

### 2.2 The numbers

**Fresh context, plain viewports (no mobile/touch emulation) — the primary table:**

| Route | 1280×900 | 390×844 | 1350×940 (LH desktop geometry) | 412×823 @1.75 (LH mobile geometry) |
|---|---|---|---|---|
| `/` | **0.1988** (5 shifts, 1.82–2.98 s) | **0.2409** (5 shifts) | — | — |
| `/map` | 0.0234 (5 shifts, 0.26–0.87 s) | *not measured* | — | — |
| `/data` | 0.0471 (3 shifts, 0.14–0.50 s) | *not measured* | — | — |
| `/trends` | **0.4093** (2 shifts, 0.17–0.55 s) | **0.8002** (3 shifts) | **1.1506** | **0.8232** |

Core Web Vitals "good" is ≤ 0.1. So on this evidence the deployed site **passes on `/map` and `/data` at 1280 and fails on `/` (0.20) and `/trends` (0.41 at 1280, 0.80 at 390, 1.15 at 1350)**.

**Run-to-run variance, stated rather than averaged:** `/trends` @1280 measured **0.2722** in an earlier run of this same job and **0.4093** here, same method and viewport. The difference is whether the second shift lands inside the same 5 s window. Quote it as "0.27–0.41", not as one number.

**Mobile/touch-emulated context (`390×844`, `deviceScaleFactor 2`, `isMobile`, `hasTouch`):**

| Route | CLS excluding `hadRecentInput` | CLS including `hadRecentInput` |
|---|---|---|
| `/` | 0.0762 | 0.1128 |
| `/map` | 0.0007 | **0.5514** |
| `/data` | 0.0025 | **0.5509** |
| `/trends` | 0.0000 | **0.2428** |

**This split matters and is the single most important measurement caveat in this report.** The page recorded **zero input events**, yet Chrome flagged shifts as `hadRecentInput` in every touch-emulated context (and never in a plain context — flagged total is exactly `0` on all four routes at 1280). The flag is set by the touch-emulation setup, not by a user. Lighthouse's mobile profile uses the same emulation, which is why **Lighthouse reports mobile CLS 0 for `/trends` while the layout demonstrably shifts**. The "including" column is the honest estimate of what a real phone user sees; the "excluding" column is the standard metric as the tooling computes it here. Both are reported; neither is silently dropped.

### 2.3 Cross-engine check

`nfunc.run_lighthouse` on `/trends` (`raw/lh-trends/`):

| Profile | Perf | A11y | Best-practices | SEO | CLS | TTFB |
|---|---|---|---|---|---|---|
| desktop 1350×940, unthrottled | 75 | 96 | 100 | 100 | **1.0253** (flagged P1: `cumulative-layout-shift`) | 74 ms |
| mobile 412×823 @1.75, slow 4G + 4× CPU | — | — | — | — | **0** (touch-emulation artefact, see 2.2) | — |

My direct run at Lighthouse's desktop geometry reproduced **1.1506** against Lighthouse's **1.0253** — same order of magnitude, same culprits. That agreement is why I am confident the desktop numbers are real and the mobile zero is an artefact.

### 2.4 Culprits (responsible elements)

One pattern repeats on every route: **above-the-fold blocks reflow after hydration/streaming**.

| Route / width | Shift | Value | Element | prev → cur |
|---|---|---|---|---|
| `/` @1280 | @1.82 s | 0.1623 | `FOOTER.border-t border-zinc-800 bg-zinc-950` | `[0,711,1265,189]` → `[0,0,0,0]` |
| `/` @1280 | @2.54 s | 0.0346 | `DIV.space-y-3` + hero `DL.mt-6.grid…md:grid-cols-4` | `[16,517,1233,383]` → `[16,573,1233,327]` |
| `/` @390 | @1.66 s | 0.1513 | hero `DL.mt-6.grid grid-cols-2 … md:grid-cols-4` | `[41,380,293,253]` → `[41,468,293,253]` (moves 88px, height unchanged) |
| `/` @390 | @1.00 s | 0.0867 | `SECTION.grid gap-3 md:grid-cols-3` | `[16,709,343,135]` → removed |
| `/map` @1280 | @0.26 s | 0.0189 | `FOOTER` | `[0,711,1265,189]` → `[0,824,1265,77]` |
| `/data` @1280 | @0.14 s | 0.0289 | `FOOTER` | `[0,711,1265,189]` → `[0,883,1265,17]` |
| `/data` @1280 | @0.50 s | 0.0163 | `DIV.flex items-center gap-2 border-t …p-2` + `FOOTER` | both → `[0,0,0,0]` |
| `/trends` @1280 | @0.17 s | 0.2120 | `FOOTER` | `[0,711,1265,189]` → `[0,0,0,0]` |
| `/trends` @1280 | @0.55 s | 0.1973 | `DIV.grid gap-3 md:grid-cols-2` + **`SECTION.panel p-3` (health card)** | card `[16,318,1233,156]` → `[16,276,1233,156]` |
| `/trends` @390 | @0.37 s | 0.5581 | `FOOTER` | `[0,379,375,465]` → `[0,0,0,0]` |
| `/trends` @390 | @0.76 s | 0.2417 | **`SECTION.panel p-3` (health card)** | `[16,512,343,333]` → `[16,472,343,357]` (moves 40px **and** grows 24px) |
| `/trends` @1350 | @0.41 s | 0.9702 | `MAIN.mx-auto w-full max-w-7xl flex-1 px-4 py-4` | `[35,41,1280,710]` → `[28,41,1280,899]` |

The footer is the number-one contributor on **every** route: it is painted at ~189 px tall near the bottom of the viewport, then collapses to 17/77 px or is removed entirely once the page content finishes streaming, dragging everything below it. The hero `DL`/KPI row is the number-two contributor. On `/trends` the health card is itself a shift source at both widths.

### 2.5 The "health card height constant" claim

| | Claim (previous gate) | Measured now | Verdict |
|---|---|---|---|
| card height @1280 | "constant 351 px" | **156 px**, identical right after `load` and at +10 s, on `/data` and `/trends` | **refuted (value wrong by 195 px)** |
| card height @390 | "constant 387 px" | **357 px**, identical right after `load` and at +10 s, on both routes | **refuted (value wrong by 30 px)** |
| does the card self-shift? | "no — the card does not self-shift" | at 1280 the **height** is stable but the card **moves 42 px up** inside the viewport; at 390 it moves **40 px up and grows 24 px** (333→357) during load | **partly refuted** |

So the earlier gate reached the right *conclusion* ("the card does not resize itself out from under the reader" is true at 1280) from the wrong numbers, and missed that at 390 the card both moves and grows — a counted 0.2417 shift at 390 and 0.2756 at 412, plus a contributing source in the 0.1973 shift on `/trends` @1280.

### 2.6 Result of the health-card fix, for the builder

`section[aria-labelledby="ingestion-health-heading"]` is now **156 px @1280 / 357 px @390, stable after settling**. To remove the remaining shifts, the fix is not on the card: give the **footer** and the **hero `DL` row** a reserved size (or render them at final size from the first paint) so content below them does not get pushed, and reserve the card's own block height at mobile widths. The `docH` growth (`/trends`: 4270 → 4807 between `load` and +10 s) is content arriving *below* the fold, which is harmless.

---

## 3. Task 3 — ingestion health card vs `/api/health`, field for field *(regression on 1.4)*

`/api/health` and `/api/meta` were fetched at the same moment as the rendered cards.

| Card row (rendered) | `/api/health` | Match |
|---|---|---|
| `LAST SUCCESSFUL RUN` → `Oct 16, 06:07 UTC` / `1,011 rows loaded` | `last_success.finished_at = 2026-10-16 06:07:44.532607+00`, `records_loaded = 1011` | ✔ |
| `NEXT SCHEDULED RUN` → `Oct 17, 10:00 UTC` / `cron 0 10 * * * UTC` | `next_run_at = 2026-10-17T10:00:00.000Z`, `cron = "0 10 * * *"` | ✔ |
| `COVERAGE (SAMPLE)` → `1,011 of ~22.8k` / `4.4% of Zillow NYC actives — a sample` | `tracked = 1011`, `market_reference = 22801`, `coverage_pct = 4.4` | ✔ |
| `RUNS · LAST 30 DAYS` → `2 ok / 0 failed` / `no failed runs in the window` | `runs_ok_30d = 2`, `runs_failed_30d = 0`, `last_failure = null` | ✔ |
| `HISTORY DEPTH` → `2 daily snapshots` | `snapshot_days = 2`, `latest_snapshot_date = 2026-10-16` | ✔ |
| run id in the header tooltip: `20261016-055515` | `last_success.run_id`, and `/api/meta.run_id` | ✔ |

Identical text at **390 and 1280**, on **`/data` and `/trends`**. `/api/meta` agrees independently (`total_tracked 1011`, `high_count 43`, and the home KPI reads "43 motivated sellers"). `last_failure` and `latest_snapshot_date` have no dedicated row — a presentation choice, not a mismatch.

**VERIFIED — no regression on 1.4.**

---

## 4. General gate checks — what this session's pass actually covers

| Check | Result | Basis |
|---|---|---|
| **1. Renders** | **PASS** | `/`, `/map`, `/data`, `/trends` all 200; fresh screenshots this pass: `evidence/panel-data-1280-recheck.png`, `evidence/panel-map-1280-recheck.png`; plus the earlier `panel-data-1280.png`, `panel-data-1280-rowvisible.png`, `panel-data-390.png`, `panel-map-1280.png`, `panel-map-390.png`. |
| **2. Console-clean** | **PASS on `/data`, `/map`** (0 errors, 0 warnings, 0 4xx/5xx, 0 failed requests) · **not re-captured on `/` and `/trends` this pass**; indirect support: Lighthouse `best-practices: 100` on `/trends` (its `errors-in-console` audit passes). One unexplained non-reproducing TLS transient on one `/map` run — see 1.6. |
| **3. Links + nav** | **NOT RE-MEASURED this pass.** Carried from the previous gate: internal links resolve, no dead buttons. New evidence relevant to nav: the panel opens and closes correctly with real clicks from both `/data` and `/map`. |
| **4. Responsive** | **PASS on horizontal scroll** — `scrollWidth == clientWidth` on `/` (390/390), `/map` (390/390), `/data` (390/390), `/trends` (390/390), and 1265/1265 at 1280 on all four. **Tap targets: FAIL** — the `/map` **listing pin is 14×14** (< 24, measured live); MapLibre's controls are 29×29 (zoom in/out, compass) and the attribution toggle is exactly 24×24, and the cluster marker is 28×28 — all fine; the score checkboxes/sort headers/footer links from the previous gate are unchanged in the deployed bundle. |
| **5. A11y baseline** | **PARTIAL, one active failure**: `/map` listing pins on production are `role=null`, `tabindex=null`, `aria-label="Map marker"` → keyboard users still cannot open a listing from the map (**S1 not deployed**). `site/components/DealMap.tsx` in the working tree already carries the fix. One `h1` per page, alt text (N/A — no `<img>`; canvas + inline SVG), labels, focus-visible and AA contrast were **not re-measured this pass** — the previous gate's findings (S4 contrast, S5 unnamed controls) stand unless the builder has changed them, and nothing in this pass contradicts them. |
| **6. Perf + meta** | **PARTIAL.** Title + description + `og:title`, `og:description`, `og:locale`, `og:type` **are present** (this differs from the previous gate's "no `og:*`" — the deployed build now has them). **`og:image`, `twitter:*` and `rel=canonical` are still absent**, so a pasted link still renders no preview card. No `<img>` elements exist → image sizing/lazy is N/A. Lab perf on `/trends`: desktop 75 (CLS is a P1 finding), TTFB 74 ms — the layout-shift work is the whole performance story. |
| **7. Spot-check** | **PASS for the copy I read fresh**: the `/data` table row, the full panel text on both `/data` and `/map`, the `/map` page body ("133 of 1011 shown · click a pin for the deal card"), and the health card. Real listing data, coherent DOM/drop/price, no lorem ipsum, no placeholder, no TODO/FIXME. `/` was not re-read end-to-end this pass (only measured for CLS). |

---

## 5. Discrepancies vs the brief and vs the previous report

1. **133 rows, not 157.** The default-view API returns **133** (`live:true`), and the arithmetic closes: 43 High + 90 Medium with DOM ≥ 60 = 133, with `/api/meta.high_count = 43` matching the home KPI. I could not find a 157 anywhere in the repo's documentation (the two repo mentions of "157" are *157 ZIPs*, a different figure), so the brief's row count is unexplained — but 133 is correct and self-consistent. The previous gate also measured 133 and explained its own 160 as a probe that double-encoded `%2C` and widened to all scores.
2. **No reachable series shows a real price movement.** 10 of 133 listings have 2 snapshots; **all 10 are flat** (same price on both rows); **0 have ≥3**. The panel's headline feature is proven against real data, but only in its flat-series form. A sloped sparkline, a mid-series reduction, and the "2 points differ" copy path remain **unverified** — the data to exercise them does not exist yet.
3. **The health card's height claim was numerically wrong** (156 @1280 / 357 @390, not 351 / 387) and the card *does* move and grow during load at mobile widths.
4. **The map panel question is settled: it opens with a real click, and a synthetic click also works.** The previous "synthetic click does not open it in prod" was a measurement artefact caused by 1.5 s marker churn.
5. **The previous "all pages console-clean" claim survives where I re-measured it** (`/data`, `/map`: 0/0/0), but I saw one non-reproducing `ERR_SSL_PROTOCOL_ERROR` transient on `/map` that I am reporting rather than discarding.
6. **`og:*` is no longer entirely absent** — four OpenGraph tags are now served. The previous report's S3 is therefore **partly fixed**; `og:image` / `twitter:*` / canonical remain missing.
7. **S1 is still not deployed.** The fix exists in the working tree; production serves `aria-label="Map marker"`, no `role`, no `tabindex`, on 14×14 pins.
8. **`jobs/*/evidence/` is listed in `.gitignore` (line 54)**, so this report and its screenshots are **not committed** — contrary to the brief's assumption that the evidence directory is committed. Same for `jobs/*/raw/`. Evidence lives on disk only.

---

## 6. What I did NOT verify — stated plainly

1. **A list-price *movement* in the panel.** Every reachable 2-point series is flat; nothing with ≥3 snapshots exists. The sparkline's multi-point path, its y-axis scaling and its polygon fill were **never rendered against real data**.
2. **`/map` and `/data` at 390 in a plain (non-touch) context.** They were measured at 390 only inside the touch-emulated context (0.0007 / 0.0025 excluding flagged shifts, 0.5514 / 0.5509 including them). Given what `/trends` and `/` do at 390 in a plain context (0.80 / 0.24), I would expect the honest `/map` and `/data` 390 values to be near 0.55, not near 0.00 — but I measured them one way only and am labelling the other cell *not measured*.
3. **`hadRecentInput` attribution.** I proved it is *not* user input (zero input events recorded) and that it appears only under touch emulation. I have not proven the exact Chrome mechanism that sets it.
4. **Real-device CLS.** All CLS is headless chromium with no throttling. Lighthouse's mobile profile (slow 4G + 4× CPU) ran only on `/trends` and returns CLS 0 for the touch-emulation reason in 2.2. Real-device, CrUX-style field data is not available for this site.
5. **Cross-browser.** Chromium only — no Firefox/WebKit pass. MapLibre's behaviour and the footer reflow could differ.
6. **The 24px tap-target audit and the contrast/label findings were not re-measured** this pass. I re-measured only the filter controls that appeared in DOM dumps plus the map pin and MapLibre controls.
7. **No load/concurrency test**, and the `/api/health` transient-downgrade issue (S12 in the previous report) was not re-tested.
8. **`/` copy was not re-read end-to-end** this pass (only its CLS). No page was edited, built locally, or deployed during this job.

---

## 7. Evidence index

| File | Proves |
|---|---|
| `evidence/qa_report.md` | this report |
| `evidence/panel-data-1280-recheck.png` | the populated panel opened from a `/data` row cell click during this pass |
| `evidence/panel-data-1280.png`, `evidence/panel-data-1280-rowvisible.png` | panel + clicked row at 1280 |
| `evidence/panel-data-390.png` | panel at 390 (mobile emulation, no horizontal scroll) |
| `evidence/panel-map-1280-recheck.png` | the populated panel opened by a **real coordinate click** on a `/map` pin during this pass |
| `evidence/panel-map-1280.png`, `evidence/panel-map-390.png` | map panel at both widths |
| `raw/api-snapshot.json` | `/api/health`, `/api/meta`, `/api/deals` (133), `/api/listing/455058452`, snapshot-depth distribution, served `<head>` |
| `raw/cls-runs.json` | every CLS run, per-shift culprits, the geometry sweep, the Lighthouse cross-check, health-card heights |
| `raw/panel-and-map-verify.json` | panel DOM text, sparkline attributes, the zoom/click sequence, hit-test, synthetic-vs-real click answers, marker churn, console/network |
| `raw/health-card-vs-api.json` | the field-by-field 1.4 comparison |
| `raw/lh-trends/trends_desktop.json`, `trends_mobile.json`, `_index.json` | Lighthouse reports (desktop CLS 1.0253 P1, mobile CLS 0) |

**No file outside `jobs/tier1-panel-verify/` was created or modified; nothing was committed or pushed; no `vercel` command was run; the deployed URL is the only thing measured.**
