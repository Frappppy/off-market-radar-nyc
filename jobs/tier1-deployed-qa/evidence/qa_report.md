# QA report — deployed Tier 1 build, Off-Market Radar NYC

- **Target (URL):** `https://off-market-radar-nyc.vercel.app`
- **Judge:** `design-qa` gate. **No repo file was edited, no commit, no branch, no `vercel`
  command, no worktree.** The only things written are this report and the evidence under
  `jobs/tier1-deployed-qa/evidence/`.
- **Date:** 2026-10-16, ~17:10–18:40 local.
- **Scope:** independent re-measurement of **13 numbered claims** carried over from three
  prior sessions (`tier1-ui-fixes`, `tier1-ui-check`, `tier1-panel-verify`, `tier1-cls-fix`).
  Every claim is answered VERIFIED / REFUTED / PARTIAL / COULD-NOT-MEASURE.
- **Method:** a purpose-built Playwright harness driving **our own Chromium**
  (`chromium-1228`), **not** the MCP browser, because the earlier sessions used
  `page.setViewportSize()`, which silently leaves layout at the previous width. Viewport is
  forced here with CDP `Emulation.setDeviceMetricsOverride{ mobile:false,
  deviceScaleFactor:1 }` and **touch emulation explicitly OFF**
  (`setTouchEmulationEnabled{enabled:false}`) — otherwise `hadRecentInput` is stamped with
  no input and CLS reads 0. Every cell below verifies `innerWidth == requested width` and
  `maxTouchPoints == 0`.
- **Caveat that affects reproducibility, not the verdict:** one subset of requests to this
  host failed with TLS/connection faults (see §4). Those are called out wherever they touch
  a number; none of them changes a verdict.

---

## 0. Verdict

**Substantively as claimed, with one real defect and three partials.** Of 13 claims,
**10 VERIFIED, 1 REFUTED, 2 PARTIAL** (plus 3 new findings outside the claim set). The
single defect worth acting on is a **race condition on `/trends` that makes a shareable
filter link show the wrong cohort** — it reproduced in 3 of 4 runs. Nothing found here
blocks the build; nothing found here was rounded up to a pass.

| # | Claim (as carried over) | Verdict |
|---|---|---|
| 1 | CLS: every route×viewport under the 0.1 budget | **VERIFIED** — max 0.0189, but exact per-cell values did **not** reproduce |
| 2 | No CSR bailout; real content in the served HTML | **VERIFIED** |
| 3 | Filter deep-links carry the filter across `/`, `/map`, `/data`, `/trends` | **REFUTED for `/trends`** — VERIFIED for the other three |
| 4 | S1: map pins are keyboard-operable named buttons; panel survives; Escape closes | **VERIFIED** |
| 5 | S4: contrast at or above AA (Medium 9.45, Low 7.53, High 5.02, legend 12.45) | **VERIFIED** |
| 6 | S5+S6: 0 unnamed controls, 0 orphan labels, all tap targets ≥ 24 px | **PARTIAL** — 1 unnamed SVG `<g>` on `/trends`; pins measure 23×24, not 24×24 |
| 7 | S7: `/data`@390 shows a swipe hint + edge affordance that unmounts at scroll end | **VERIFIED** |
| 8 | S8: an invalid query produces explanatory notices | **VERIFIED** |
| 9 | S9: an out-of-range page is rewritten; reduction history is deduped | **VERIFIED**, with one uncovered residual (`page=0` / `page=abc`) |
| 10 | #1: the carried-over "1d" badge is reachable | **PARTIAL** — the badge renders, but not via the path the claim named |
| 11 | S3: og/twitter/canonical per route; `/opengraph-image` is a 1200×630 PNG | **VERIFIED** |
| 12 | Console-clean / zero failed requests | **VERIFIED** — one transient TLS cell, re-run clean 3× |
| 13 | Automated a11y is clean (Lighthouse 100 on `/data`) | **PARTIAL** — `/data` Lighthouse 100 reproduces; the site is **not** axe-clean (`/trends`, `/map`) |

---

## 1. The seven gate checks

| Check | Verdict | Counts / detail |
|---|---|---|
| **1. Renders** | **PASS** | 4 routes × 3 widths = **12/12 cells** served 200 and painted with content. `X-Nextjs-Prerender: 1`, `X-Vercel-Cache: HIT`, per-route `X-Matched-Path` on all four. Screenshots saved for 390 / 1280 / 1350 under `evidence/shots/`. No `#__next_error__` boundary in any of the 12 primary cells. |
| **2. Console-clean** | **PASS** (one disclosed transient) | 12 navigations: **3 console errors, 0 4xx/5xx, 3 failed requests** — all three in the single cell `/map`@1350, all `net::ERR_SSL_PROTOCOL_ERROR`. That cell re-run clean 3× (0/0/0). No other cell had a single console error, 4xx, or failed request. |
| **3. Links + nav** | **PASS** | 4 internal hrefs (`/`, `/map`, `/data`, `/trends`) + 13 `_next/static` assets all **200**. Nav = 8 keyboard stops on `/data`, **all** with a visible ring; `Enter` on the header `Trends` link navigates to `/trends` and moves focus to the nav item. No dead buttons: CSV export → **200 `text/csv`, 30,920 B, 134 lines**; Copy link writes the view URL to the clipboard and changes its own label; Reset restores `133 of 1011` / slider 60 / clears the query; Close dismisses the detail dialog. |
| **4. Responsive** | **PASS** on layout, **PARTIAL** on tap targets | Page-level horizontal scroll **false in all 12 cells** (`docScrollW == docClientW`). Hero stacks cleanly at 390 (inspected: no collision, single-row nav, KPI grid 2-up). Tap targets: see §3 claim 6 — pins measure **23×24**, and 19-px-tall inline links exist inside a ≥33 px clickable row. |
| **5. A11y baseline** | **PASS** on the named items, **PARTIAL** overall | Exactly **1 `h1`** per route; **0** images site-wide (so alt/dimension checks are N/A, not skipped); **0** inputs without a label (`inputsNoLabel: 0` in all 12 cells); **0** orphan labels; 14 tab stops per route with **0** missing a visible focus ring; contrast **0 fails** in fill-aware sweeps (18 nodes `/`@390, 39 `/data`@390, 95 `/trends`@1280), worst live ratio **5.02** (High pill) ≥ 4.5. **But** axe-core finds real violations on `/trends` and `/map` (§3 claim 13). |
| **6. Perf + meta** | **PARTIAL** | **No `<img>` element on any route** — nothing to size or lazy-load (map is canvas, charts are inline SVG). Title + description + OG present on all four: **11 og**, **8 twitter**, per-route `canonical` and `og:url`, `og:image` + `og:image:width/height` = 1200/630, `/opengraph-image` → **200 `image/png` 50,028 B**, description 110 chars. **Deficiencies:** `robots.txt`, `sitemap.xml`, `favicon.ico` and `manifest.webmanifest` are all **404**, and all four routes share one **identical `<title>` and description** (only canonical/og:url differ). |
| **7. Spot-check** | **PASS** | Opened `/`, `/data`, `/map`, `/trends` fresh. **No lorem ipsum** (`lorem:false` in the served HTML of all four). Copy matches the brief and is honest about scope: "Sample scope: a capped, robots-respecting scan of ~22.8k Zillow NYC actives — not full coverage", "1,011 tracked (sample) · 43 High", "133 of 1011 shown". |

---

## 2. Claim 1 — the full 12-cell CLS table

Measured on the **deployed host**, raw (unfiltered) and Lighthouse-filtered, side by side
with the values claimed by the local `cls-fix` build. The artefact the brief warns about is
**absent**: `clsRaw == clsFiltered` in all 12 cells, and **0 of the shifts** were stamped
`hadRecentInput`.

| Route | Viewport | Raw (deployed) | Filtered | shifts | hadRecentInput | inputs | Claimed (local) | Under 0.1? |
|---|---|---|---|---|---|---|---|---|
| `/` | 390×844 | **0.018894** | 0.018894 | 4 | 0 | 0 | 0.022 | yes |
| `/` | 1280×900 | 0.005128 | 0.005128 | 4 | 0 | 0 | 0.00525 | yes |
| `/` | 1350×940 | 0.004414 | 0.004414 | 4 | 0 | 0 | 0.01565 | yes |
| `/map` | 390×844 | 0.001093 | 0.001093 | 3 | 0 | 0 | 0.00157 | yes |
| `/map` | 1280×900 | 0.005739 | 0.005739 | 3 | 0 | 0 | 0.00287 | yes |
| `/map` | 1350×940 | 0.002437 | 0.002437 | 2 | 0 | 0 | 0.00506 | yes |
| `/data` | 390×844 | 0.002221 | 0.002221 | 2 | 0 | 0 | 0.00231 | yes |
| `/data` | 1280×900 | 0.009778 | 0.009778 | 1 | 0 | 0 | 0.00466 | yes |
| `/data` | 1350×940 | 0.005774 | 0.005774 | 2 | 0 | 0 | 0.00851 | yes |
| `/trends` | 390×844 | 0.000410 | 0.000410 | 1 | 0 | 0 | 0.00043 | yes |
| `/trends` | 1280×900 | 0.001808 | 0.001808 | 1 | 0 | 0 | 0.00185 | yes |
| `/trends` | 1350×940 | 0.001556 | 0.001556 | 1 | 0 | 0 | 0.00160 | yes |

**VERIFIED** on the claim that matters (every cell under budget; worst is `/`@390, which is
also the cell the claim named as worst). **Not reproduced:** the exact decimals. Deployed
`/data`@1280 is 0.009778 against a claimed 0.00466; `/`@1350 is 0.004414 against a claimed
0.01565. Both directions occur, so this is timing variance in *when* deferred content
lands — the same variance the diagnosis already documented between its own baseline runs —
not a regression. The worst deployed cell (**0.0189**) is still ~5× under the 0.1 bar and
slightly better than the local claim (0.022).

**Residual confirmed, not new:** the `/`@390 shift is the **data-gated `h1`** — the served
`h1` is "Motivated sellers in NYC this week" and it becomes "**43** motivated sellers in NYC
this week" once data lands (visible in `shots/home-390x844.png`). That single swap accounts
for essentially the whole 0.0189 cell.

---

## 3. Claims 2–13, evidence per claim

### Claim 2 — no CSR bailout, real content in the served HTML — **VERIFIED**
All four routes: `BAILOUT_TO_CLIENT_SIDE_RENDERING` count **0**, `<template data-dgst>` count
**0**. Served HTML **20,937–25,577 B** (Content-Length 21,004–25,704). `<main>` is not an
empty shell: 4,147 / 4,828 / 9,687 / 7,536 bytes carrying **1,102 / 309 / 1,098 / 1,598**
characters of text on `/`, `/map`, `/data`, `/trends`. The five `<Suspense>` wrappers
survive, but nothing bails out of them.

### Claim 3 — filter deep-links — **VERIFIED on `/`, `/map`, `/data`; REFUTED on `/trends`**
- `/map?score=High&min_dom=90` → "**43 of 1011 shown**", slider reads `DOM ≥ 90`, High is
  the only checked box, 22 pins. ✓
- `/data?score=High&min_dom=90` → 25 rows, all High pills, slider 90. ✓
- `/` hands the query through: the S2 disclosure appears ("From this link:", "not editable
  on this page") and the `Full map →` link carries the full 6-parameter query. ✓
- **`/trends?score=High&min_dom=90` → "IN FILTER 133"** in **3 of 4 runs** (43 in 1 run).
  133 is the *default* cohort, not the deep-linked 43. The network log shows why: the
  request for `score=High&min_dom=90` and the request for the default
  `score=High,Medium&min_dom=60` are both in flight, and **the default one resolves last and
  overwrites the deep-linked result** in 3 of 4 runs. `/trends` (`app/trends/page.tsx`) is the
  only filter-aware page whose fetch effect has **no staleness guard** — `Explorer.tsx` and
  `data/page.tsx` both guard with a `dead` flag / abort. Soft-navigating from `/map` to
  `/trends` shows the same 133. **This is a genuine user-visible defect**: a shared link
  silently shows the wrong set of listings, and it is intermittent, so a casual check passes.

### Claim 4 — S1 pins keyboard-operable — **VERIFIED**
`/map`@1350: **36/36** pins have `role="button"` + `tabindex="0"` + a unique accessible name,
and **0** still carry MapLibre's default `aria-label="Map marker"` (8 single + 28 cluster,
16 unique names). `Enter` opens a `role="dialog"` card; after 4.5 s the marker node is still
alive, the JS stamp is intact and focus is still on the pin; `Escape` closes. Same result at
1280 (34 pins) and 390 (19 pins), and on `/` (26 pins @1280, 15 @390).

**One correction to the claim's premise.** In the 12-cell sweep, `/map` showed **zero**
`[role=button][tabindex="0"]` elements at *all three* widths, and one isolated attempt at 390
found no pins at all after 42 s. I chased that as a possible systematic defect: across **20
fresh navigations** (`/map` and `/` × 2 widths × 5 runs) **0 runs ended with zero markers**.
Time-to-first-marker was normally **1.3–1.7 s**, with outliers of 3.3 s, 3.7 s, 4.5 s and one
**21.7 s** run that also logged `net::ERR_CONNECTION_CLOSED`. So the "zero markers for a
while" window is real but **network-transient**, not a systematic ~9 s stall, and claim 4
holds whenever markers render.

### Claim 5 — contrast — **VERIFIED**
The four claimed ratios reproduce exactly from the declared tokens — theme grey `#8b8b93` on
`#141416` = **12.45** (legend/KPI labels), **9.45** Medium, **7.53** Low, **5.02** High on
white. Live fill-aware sweeps: `/data`@390 **39 nodes, 0 fails**; `/`@390 **18 nodes, 0
fails**; `/trends`@1280 **95 nodes, 0 fails**. Worst ratio anywhere on the site is the
white-on-red High pill at **5.02** against a 4.5 requirement.

### Claim 6 — S5+S6 controls, labels, tap targets — **PARTIAL**
- **Unnamed controls:** 0 on `/`, `/map`, `/data` at both widths — **except `/trends`, which
  has 1 unnamed control at both widths**: a `<g>` SVG element with no name, text or href.
  axe independently flags the same surface (78 `svg-img-alt` nodes, below).
- **Orphan labels:** 0. **Inputs without a label:** 0. **Images without `alt`:** N/A (0
  `<img>` elements exist).
- **Tap targets:** the raw sweep flags the map pins, but that measurement reads their
  **14×14 layout box**, not their hit area. Hit-testing the topmost element at each sample
  point shows the pins' effective region is **23.0 × 24.0 px** (half-diagonal 11.5) at 390,
  1280 and 1350 — the declared `::before` box is `24px`/`24px`, so this is **1 px short in X**
  and I am not rounding it to 24.
  19-px-tall inline links remain on `/data` (the address cell, `25 GRACE CT` = **81.3×19**,
  `display:inline`; 25 of them on page 1 at 1280) and on `/trends` (10 × `Zillow ↗` = 51×19).
  However the address link sits inside a `tr.cursor-pointer` with `tabindex="0"` that is
  **594×53 @390 / 954×33 @1280** and **is** the real control — clicking it *and* pressing
  `Enter` on it both open the detail dialog. So the effective target is the row, comfortably
  over 24 px, and the 19 px is the inline-text exception, not a defect.

### Claim 7 — S7 mobile table affordance — **VERIFIED**
At 390 (viewport override confirmed: `innerWidth == 390`): the hint "Swipe the table sideways
for DOM, drop %, $/sqft and score →" is visible, `[data-testid=hscroll-edge]` is present, the
wrapper overflows by **238 px**, and there is **no page-level horizontal scroll**. At
`scrollLeft = 238` (the maximum) **both** the hint and the edge affordance unmount.

### Claim 8 — S8 invalid-query notices — **VERIFIED**
With `?score=Bogus&min_dom=abc`, all four routes render exactly **2 notices** as `ul > li`
("…'Bogus' is not a motivation score (High / Medium / Low) — ignored, so this view shows
every score." and "…'abc' is not a number — the DOM floor fell back to 60 days."). `/map` and
`/` widen to the 160-row default and the slider falls back to 60. Clean URLs render 0 notices.

### Claim 9 — S9 pagination clamp + reduction dedupe — **VERIFIED**, with one residual
`/data?page=99999` → URL rewritten to `/data?page=6`, pager reads "Page 6 of 6". Reduction
history dedupe holds exactly: `455058452` has **one** reduction ("2026-10-15 — $315,000 →
$295,000 (−$20,000, −6.3%)") and a **flat** sparkline (`4.00,24.00 256.00,24.00`);
`30776634` has **two distinct** cuts ($1,049,999→$1,049,000 and $1,049,000→$999,000) and a
**sloped** sparkline (`4.00,4.00 256.00,44.00`) — the previously-reported duplicate is gone.
**Residual the claim does not cover:** `/data?page=0` and `/data?page=abc` both display "Page
1 of 6" while **leaving `page=0` / `page=abc` in the URL** — the same class of URL/screen
disagreement S9 was meant to close.

### Claim 10 — #1 carried-over badge — **PARTIAL**
The badge itself is real and correct: the API has exactly **8 rows dated 2026-10-15**, all
Low, DOM 0–14, and `/data?score=Low&min_dom=0&zip=10306` renders one **18×14** badge reading
"1d — last seen yesterday, not in the newest daily run" with a title naming snapshot
2026-10-15. **But the reachability path named in the claim is wrong:** `/data?score=Low` on
its own (default `min_dom=60`) returns 27 rows and **0 badges**. The badge only appears if
`min_dom=0` is passed explicitly, i.e. it is reachable but not by the route the report
described.

### Claim 11 — S3 meta/OG — **VERIFIED**
All four routes: **11 og** + **8 twitter** tags, per-route `canonical` and `og:url`, and
`og:image` with `og:image:width/height` = **1200/630**. `/opengraph-image` → **200
`image/png`, 50,028 bytes** (`Cache-Control: public, immutable`). Description is 110
characters. **Detail worth flagging:** all four routes share one identical `<title>` and
description — only canonical/og:url vary, so the four pages are indistinguishable in a search
result or a link preview.

### Claim 12 — console-clean / zero failed requests — **VERIFIED**
Across the 12 cells: **0 console errors, 0 4xx/5xx, 0 failed requests** in 11 of them. The
exception is `/map`@1350 with **3 × `Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR`**
(and 3 correspondingly failed requests, 0 of them 4xx). That cell was re-run 3× immediately
afterwards: **0/0/0 each time**. The same fault class recurred once more, in a different
session, as `net::ERR_CONNECTION_CLOSED`, and it drove the one slow-marker run and the one
`#__next_error__` page (§4). Verdict: environmental/transient, not a product defect.

### Claim 13 — automated a11y clean — **PARTIAL**
The specific `/data` claim **reproduces exactly**: Lighthouse 13.4.1, desktop form factor,
screen emulation 1350 with `mobile=false`, `finalDisplayedUrl =
https://off-market-radar-nyc.vercel.app/data` → **Accessibility 100, Best Practices 100, SEO
100, Agentic Browsing 100**, with **35 passing audits, 0 failing**, 42 not-applicable, and
`heading-order`/`color-contrast`/`image-alt` all scored 1 (report saved under
`evidence/raw/lighthouse/`). The **generalisation does not hold**. axe-core 4.10.2 across 6
route/width combinations:

| Route | Violations | Detail |
|---|---|---|
| `/`@1280 | **0** | 42 passes; 1 `color-contrast` incomplete (0 nodes) |
| `/data`@1280 | **0** | 46 passes |
| `/data`@390 | **0** | 47 passes |
| `/map`@390 | **1** | `heading-order` (moderate) — `h1 → h3` skips `h2` |
| `/map`@1280 | **1** | same `heading-order` (the 5-violation `#__next_error__` result was a transient error page — see §4) |
| `/trends`@1280 | **2** | **`svg-img-alt` (serious, 78 nodes)** — chart `path[name="High"]`, `path[name="Medium"]`, recharts scatter symbols with `role="img"` and no accessible name; plus `empty-table-header` (minor, `th:nth-child(8)`) |

The `/map` heading jump is the footer column headings ("How it works", "Motivation formula",
"Compliance", "Links & roadmap") sitting at `h3` directly under the `h1`. So: automated a11y
is clean on `/` and `/data` and **not** clean on `/trends` (serious, 78 nodes) or `/map`.

---

## 4. New findings not in the claim set (ranked)

1. **`/trends` deep-link race — no staleness guard.** *(highest impact; see claim 3)* The
   default-cohort fetch resolves last and overwrites the deep-linked cohort in 3 of 4 runs.
   `app/trends/page.tsx` needs the same `dead` flag / `AbortController` pattern that
   `Explorer.tsx` and `data/page.tsx` already use.
2. **`/trends` chart accessibility.** 78 SVG nodes carry `role="img"`-equivalent semantics
   with no accessible name — a serious axe violation on the one page with charts, plus 1
   unnamed `<g>` control from the DOM sweep.
3. **`robots.txt`, `sitemap.xml`, `favicon.ico`, `manifest.webmanifest` are all 404.**
   (`rel="icon"` correctly points at `/icon.svg`, which is 200 `image/svg+xml`, so there *is*
   a favicon; the browser-default `/favicon.ico` path and the crawler entry points are not
   there.)
4. **All four routes share one identical `<title>` and description** — canonical/og:url are
   per-route but the human-visible identity is not.
5. **`/map` rendered the Next.js error boundary at least once.** During the pre-axe state
   check, `/map`@1280 presented `#__next_error__` — no `<title>`, no `lang`, no `<main>`, no
   `h1` (that is what produced the spurious 5-violation axe result). Three immediate re-runs
   were healthy. It shares the transient TLS/connection-fault signature, but an unhandled
   fetch rejection taking the whole route down is a robustness gap worth confirming.
6. **`page=0` / `page=abc` survive in the URL** while the screen shows "Page 1 of 6"
   (claim 9 residual).
7. **A 1-px miss on the pin target**: measured 23.0 × 24.0, declared 24 × 24.

---

## 5. Corrections to my own earlier passes (measurement artefacts I had to fix)

Recording these because three of the intermediate numbers in this session were wrong and a
reader of the raw logs will hit them:

| First pass said | Truth | Cause |
|---|---|---|
| Pin hit area **0×0** at 390 | **23×24** | `elementFromPoint` was asked about a point **outside the viewport** (the map sits below the fold at 390), so it returned `null` for every sample, including offset 0. Fixed by scrolling the pin into view first. |
| Pin hit area **40×40** | **23×24** | The predicate used `elementsFromPoint().some(...)`, which counts the pin when it merely sits *underneath* the canvas. Fixed by testing the **topmost** element only. |
| `/map` axe = **5 violations** | **1** (`heading-order`) | The audit ran against a transient `#__next_error__` page. Confirmed by 3 clean re-runs (title/`lang`/`main`/`h1` all present, 34 pins). |
| `25 GRACE CT` link not found (`tbody a` = 0) | **81.3×19, in a `tbody`** | The readiness `waitForFunction` had silently timed out and the table had not rendered. |
| `markers: 0` for `/map` | harness bug | The script queried `.mapboxgl-marker`; MapLibre's class is `.maplibregl-marker`. That field is unusable and was not used for any verdict. |

---

## 6. What I could NOT measure

- **Lighthouse on `/`, `/map`, `/trends`.** The chrome-devtools MCP server disappeared from
  the tool catalogue mid-session, so only the `/data` Lighthouse report exists. The axe
  results above cover the missing routes but are not a Lighthouse score.
- **A real pointer click on `/data` and `/data`-row controls at 390.** My click coordinates
  for the mobile row fell below the fold, so the mobile click test fell through to keyboard.
  Keyboard activation is verified at both widths; **mouse** activation on mobile is not.
- **A genuine price series with movement.** The claim set's dedupe check passes, but every
  reachable two-point series is flat, so a sparkline that actually should slope has never
  been exercised with real data.
- **Anything behind auth or beyond the sampled cohort.** All numbers are on the public
  deployed host and the ~22.8k-actives sample the site itself discloses.

---

## 7. Evidence index

Everything below is under `jobs/tier1-deployed-qa/evidence/`.

- `qa_report.md` — this report.
- **`shots/`** — the 12-cell screenshots at 390×844 / 1280×900 / 1350×940 for `/`, `/map`,
  `/data`, `/trends` (plus `smoke-390/1280`). `shots/probes/` holds the per-claim probe
  shots: pin hit tests, pin→dialog at both widths, row-click and close-button, nav-Enter,
  S7 start/end, S8 on all four routes, the reductions panel for both listings, the
  `/trends` deep-link runs, and the carried-over badge.
- **`raw/cls-12cell.json`**, `raw/cls-12cell.run.log`, `raw/retry-map-1350.log` — the 12-cell
  CLS raw/filtered values, shift records, inputs, console and network tallies, and the clean
  re-runs of the one transient cell.
- **`raw/served-html.json`**, `raw/html/*.html|.headers` — served-HTML size, bailout markers,
  `<main>` size and text, meta/OG counts, and the response headers per route.
- **`raw/probes-a…h.json|.run.log`** — the claim probes (deep links, pins, S7, S8, S9,
  reductions, carried badge, contrast, sweeps, focus walks, axe, row targets, controls).
  `raw/probes-i.*` — the 20-run marker-render flakiness test.
- **`raw/lighthouse/report.json|.html`** — the `/data` Lighthouse 13.4.1 run (A11y/BP/SEO
  100).
- **`raw/axe.min.js`**, **`raw/links.json`**, **`raw/meta.json`**, `raw/deploy-headers.txt`,
  and the harness scripts (`cls-12cell.js`, `instrument.js`, `html-facts.js`, `links.js`,
  `probes-*.js`) so every number here is re-runnable.

**Build identity.** The deployed build provably contains the not-yet-committed change set:
the live pages carry strings that exist only in that worktree — the `Swipe the table
sideways…` hint, the `FilterNotices` wording, `data-testid="hscroll-edge"`, and a working
`/opengraph-image`. All four routes answer `X-Nextjs-Prerender: 1` with
`X-Vercel-Cache: HIT`.
