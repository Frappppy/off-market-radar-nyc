# QA report — Tier 1 (website half), Off-Market Radar NYC

- Judge: `design-qa` gate. **No files were edited**; the tree was left as found.
- Date: 2026-10-16, ~16:00–17:00 local.
- Scope: `docs/roadmap.md` Tier 1 items **1.1, 1.2, 1.3, 1.4** as rendered by `site/`.
- Evidence classes are labelled throughout: **[prod]** measured against a production
  build (`next build` + `next start`), **[dev]** measured against `next dev`, and
  **[source]** read from code (not executed).

---

## 0. Verdict

| Item | Verdict | One line |
|---|---|---|
| **1.1** Fix stale listings + surface "last seen" | **PASS** | Recency guard verified live (1,019 → 1,011); the per-listing label renders correctly but is structurally inert at the default window. |
| **1.2** Property detail panel with real price history | **PASS** | Panel opens from `/data` rows and `/map` pins and degrades honestly while `vw_listing_history` is ungranted. Not keyboard-reachable from the map (finding S1). |
| **1.3** Shareable filter links | **PARTIAL** | Deep links, empty-selection survival, sort/dir/page round-trip, hostile input and Copy-link all verified working. Two real gaps (S2, S9). |
| **1.4** Ingestion health card | **PASS** | All five rows agree with `/api/health`, live, on both `/trends` and `/data`. |

**No blockers found.** Seven should-fix findings, three cosmetic. Nothing in the four
items is rounded up to PASS: 1.3 is reported as partial because two of its
user-visible promises do not hold.

Environment caveat that affects reproducibility, not the verdict: **a second Next
server was running concurrently in the same directory on port 3300**, sharing
`site/.next`. That is what corrupted my first dev session and made a prod build serve
mixed `.next` output. All measurements in this report were finally taken from an
isolated production build in a temp directory (see §6).

---

## 1. Renders — PASS

All four routes serve and paint at both widths, in a production build:

| Route | 1280 | 390 | h1 |
|---|---|---|---|
| `/` | 200 | 200 | Motivated sellers in NYC this week |
| `/map` | 200 | 200 | Find the call list |
| `/data` | 200 | 200 | Take the call list with you |
| `/trends` | 200 | 200 | Market trends |
| `/icon.svg` | 200 | — | — |

`/`,`/data`,`/map`,`/trends` and all five API routes are present in the build's route
table; `next build` completed with **12/12 static pages** and no build error.

Screenshots (all in `site/shots/`):

| File | Proves |
|---|---|
| `qa-home-1280.png`, `qa-home-390.png` | Overview hero, KPI row, map, three insight cards, footer at both widths. |
| `qa-map-1280.png`, `qa-map-1280-loaded.png`, `qa-map-390.png` | Full map page before and after data resolves. |
| `qa-data-1280.png`, `qa-data-390.png` | Table + health card + filters at both widths. |
| `qa-trends-1280.png`, `qa-trends-390.png` | Seven charts + health card. |
| `qa-home-1280-deeplink.png` | The 1.3 deep link landing on `/` with **0 pins** and "0 of 1011 shown". |
| `map-1280-panel.png`, `map-390-panel.png`, `map-390-after-close.png` | Panel open and closed on the map, both widths. **[dev]** |
| `data-1280-row-picked.png`, `data-390-panel.png` | Row → panel on `/data`. **[dev]** |
| `health-card-1280.png`, `health-card-390.png` | The 1.4 card in isolation. **[dev]** |
| `health-frozen-fallback.png` | The degraded-mode badge. **[dev]** |
| `copylink-data.png`, `copylink-map.png` | Copy-link "Copied ✓" state. **[dev]** |

> Note: `shots/` gained files I did not create (`data-1280-prod.png`,
> `health-unavailable-1280.png`, and several existing files were rewritten) during this
> session. Another writer is active in this workspace — see §6.4.

---

## 2. Console-clean — PASS

**[prod]** Network and console were captured per page after load:

| Route | Console errors/warnings | Requests with 4xx/5xx |
|---|---|---|
| `/` | 0 | 0 |
| `/map` | 0 | 0 |
| `/data` | 0 | 0 |
| `/trends` | 0 | 0 |

Verified with an injected `fetch` wrapper on `/data` and `/` that every request
resolved 200 and that `window.onerror` / `unhandledrejection` recorded nothing
(`jsErrors: []`). Third-party requests to CARTO basemaps, sprites, fonts and vector
tiles all returned 200.

One benign server-side log line, by design:
`listing history unavailable for <id>: relation "vw_listing_history" does not exist`
(Postgres `42P01`), which the route catches and turns into a 200. **Not reported as a
bug per the brief** — the view is deliberately not applied yet.

---

## 3. Links + nav — PASS (with a note)

**[prod]** Only five internal links exist site-wide: `/`, `/map`, `/trends`, `/data`
and `/api/deals?...&format=csv`. All resolve 200; the CSV endpoint returns
`text/csv` with a header row + one row per listing (**134 lines for 133 rows**,
cross-checked against the on-page "Download 133 rows as CSV"). No dead buttons: every
`<button>` on the four pages is wired to a handler (sort headers, pagination,
Reset, Copy link, pin → panel, panel Close).

Header nav is four real `<a>` elements inside `<nav>`, keyboard-operable with no JS
trap. There is no hamburger/menu to test — the nav reflows below the brand at 390
rather than collapsing.

Note: outbound Zillow links are `<a target="_blank" rel="noreferrer">` and correctly
`stopPropagation` so clicking the address does **not** also open the panel (verified
in the [dev] session: `panelOpenedByLinkClick:false`).

---

## 4. Responsive — PASS on layout, FAIL on tap targets

**No horizontal scroll on any page at either width.** *(verified)*

| Route | 390px `scrollWidth/clientWidth` | 1280px |
|---|---|---|
| `/` | 390/390 | 1265/1265 |
| `/map` | 390/390 | 1265/1265 |
| `/data` | 390/390 | 1265/1265 |
| `/trends` | 390/390 | 1265/1265 |

No overlapping hero: on `/` the detail panel renders *below* the map
(`overlapsMap:false`) and the wrapper is `max-w-[20rem]`; on `/map` the panel is
overlaid with `z-10` and sized 319px inside a 343px map at 390. Panel Close hit-testing
via `elementFromPoint` succeeds at the button centre at both widths (the four corners
miss only because of `border-radius`). A live click closes the panel. **[dev]**

### Tap targets below 24×24px — many *(verified, [prod])*

| Target | Size | Page |
|---|---|---|
| Score checkboxes (`High`/`Medium`/`Low`) | **13×13** | `/map`, `/data` |
| `Reset` | 29×**16** | all |
| Range slider (`DOM ≥ N`) | any × **16** | `/`, `/map`, `/data` |
| Sort-header buttons (`address △`, `zip △`…) | 65×**20** … 50×**20** | `/data` |
| Header nav links | 57×**20**, 28×**20** | all |
| Footer links (`GitHub repo ↗`, `Call list + CSV export`) | ×**19** | all |
| Map attribution links (`MapLibre`, `CARTO`, `OpenStreetMap`) | ×**14** | `/map`, `/` |
| `Full map →` | 60×**16** | `/` |

The 13×13 score checkboxes are the worst: they are the primary control for the
product's central filter. **S6.**

### Inner scrollers (no page-level h-scroll, but content is clipped) *(verified)*

- `/data` @390: the table wrapper is `519 > 356`, so **DOM / drop% / $/sqft / score are
  off-screen with no scroll affordance** (no shadow, no hint text). **S7.**
- `/trends` @390: one chart wrapper `344 > 324` — a 20px horizontal scroll. Cosmetic.

---

## 5. A11y baseline — PARTIAL

| Check | Result | Evidence |
|---|---|---|
| Exactly one `h1` per page | **PASS** | `/`,`/map`,`/data`,`/trends` all `h1Count: 1`. Heading order h1→h2/h3 is sane (7/4/5/13 h2+h3). |
| `img` alt text | **N/A** | Zero `<img>` elements on any page — the map is a canvas, charts are inline SVG. Nothing to fail. |
| Labels | **FAIL** | See below. |
| Focus visible | **PASS** | All interactive elements carry `focus-visible:ring-2` (tables, sort headers, pager); nav/links use `hover:underline`. Verified ring classes present in the rendered DOM. |
| AA contrast on body/CTA text | **FAIL** | See below. |

### Unnamed form controls *(verified in the rendered DOM, [prod])*

`/map` and `/data` each render **five controls with no programmatic accessible name**:

1. `<select disabled>` Source — no name
2. `<select disabled>` Country — no name
3. `<select disabled>` City — no name
4. **`<select>` Type — enabled, no name** ← real defect
5. **`<input type="range">` DOM ≥ N — enabled, no name** ← real defect

Plus **9 `<label>` elements with no `htmlFor` and no wrapped control**:
`Source, Country, City, Motivation, DOM ≥ 60 days, Min price, Max price, Type,
ZIPs (comma-separated)`.

Cause **[source]**: `components/Filters.tsx` writes `<label>` as a sibling above each
control (lines 38–41, 45–55, 76–81, 85–97, 100–108, 111–116) and never sets
`htmlFor`. Only the three score checkboxes are wrapped in their label (lines 61–64),
so only those are named. `Min price` / `Max price` / `ZIPs` accidentally acquire a name
from their `placeholder`; the range slider and the `Type` select acquire nothing.
**S5.**

### Contrast *(verified by pixel readout of the computed colours, [prod])*

Passing: body text `#f4f4f5` on `#09090b` = **18.1:1**; nav links `#d4d4d8` = **13.5:1**;
`Reset` = 14.5:1; `Copy link` = 15.7:1; the primary CTA `Explore the map →`
(`#09090b` on `#f4f4f5`) = **18.1:1**.

Failing AA (4.5:1 for text below 24px / below 18.66px bold):

| Foreground | Background | Ratio | Where |
|---|---|---|---|
| `#71717b` (zinc-500) | `#141416` (panel) | **3.81:1** | `.eyebrow` section labels, 11px/600; 12px captions; `/data` empty-state text |
| `#71717b` | `#09090b` (body) | **4.12:1** | `DATA · EXPORT`, `MAP EXPLORER`, `MARKETS · CROSS-SECTION`, `Loading data…` |
| `#52525c` (zinc-600) | `#09090b` | **2.58:1** | `/map` hint "· click a pin for the deal card" |
| `#ffffff` | `#e6a817` (`--medium`) | **2.10:1** | the **"Medium" score pill** (`text-white` on the amber token) |
| `#d62728` (`--high`) | `#141416` | **3.66:1** | `High` used as *text* in the `/trends` score labels |

The two worst are the "Medium" pill at 2.10:1 and the `/map` hint at 2.58:1.
`--medium`/`--high` are the product's own motivation tokens, so S4 needs a token-level
decision (darken the amber for a white label, or flip the pill to dark text).
**[source]** for the token values: `app/globals.css` lines 14–19.

### Keyboard reachability of a listing — FAIL on `/map` *(verified, [prod])*

`/map` renders 34 map markers as
`<div class="maplibre-pin maplibregl-marker ..." aria-label="Map marker">` with
**no `tabindex`, no `role`, and `focusablePins: 0`**. A keyboard user cannot open a
listing from the map at all. `aria-label="Map marker"` is also non-specific — 34
identical names if they were exposed. Keyboard access to a listing exists **only** on
`/data`, where rows are `tabIndex={0}` with Enter/Space handlers for the same panel.
**This is the most significant gap against 1.2's own wording** ("a keyboard-focused
row") once you read it as "the map is keyboard-operable" — it is not. **S1.**

Cause **[source]**: `components/DealMap.tsx` attaches `onclick` to a plain `div`;
`app/globals.css` `.maplibre-pin` is 14×14 with a `cursor: pointer`.

Colour-only meaning: score is conveyed by both colour **and** a text label on the pill
and on every table row, so score is not colour-only. The map pins *are* colour-only
(no legend beyond the three toolbar chips) — a minor a11y note.

---

## 6. Perf + meta — PARTIAL

### Images *(verified)*

No `<img>` elements exist on any page, so "images sized/lazy below the fold" is **N/A**
rather than passing. The map is a canvas; the charts are inline SVG; the favicon is
`app/icon.svg`. This is a real strength — nothing to lazily load.

### Meta tags *(verified in the served HTML, [prod])*

| Tag | Present |
|---|---|
| `<title>` | **YES** — "Off-Market Radar · NYC — Motivated Seller Finder" (identical on all four pages) |
| `<meta name="description">` | **YES** — "Daily Zillow scrape of NYC listings scored for seller motivation. Map, trends, and CSV export for wholesalers." |
| `og:*` | **NO — none** |
| `twitter:*` | **NO — none** |
| `link rel="canonical"` | **NO** |
| `<link rel="icon">` | YES → `/icon.svg` |
| `<html lang="en">` | YES |

Confirmed both in the rendered DOM (`og: {}` on every page) and in source:
`app/layout.tsx` exports only `title` and `description` (lines 7–11); no route adds
OpenGraph metadata. **S3.** A pasted link renders no preview card, which undercuts 1.3's
whole premise of sending a view to a colleague.

### Bundle weight *(from the production build)*

| Route | Page JS | First Load JS |
|---|---|---|
| `/` | 3.72 kB | **326 kB** |
| `/map` | 2.51 kB | **325 kB** |
| `/data` | 4.69 kB | 112 kB |
| `/trends` | 119 kB | 221 kB |

326 kB first-load on the two map routes is heavy for a list-and-map tool; the shared
chunk is 103 kB and MapLibre accounts for most of the rest. Not a blocker, worth a look
before deploy.

### Robustness under load — S? (cosmetic, disclosed) *(verified, [dev])*

Four of twelve concurrent `/api/health` requests returned the frozen fallback
(`{"live":false,"tracked":82,"latest_snapshot_date":"2026-10-15"}`) while eight returned
live data; server log showed
`ConnectTimeoutError ... timeout: 10000ms` → `fetch failed`. Every API route converts a
single transient into a **site-wide downgrade with no retry**. Not reproducible on
demand (a later 42/42 run was fully live). The UI *does* disclose it
(`health-frozen-fallback.png` shows the "frozen fallback — Neon unreachable" badge), so
this is a robustness note, not a correctness blocker.

---

## 7. Spot-check — PASS

Two pages opened fresh and read end to end.

- **`/`** — headline "43 motivated sellers in NYC this week" matches the live High count
  (43). KPI row reads TRACKED 1,011 (4.4% of ~22.8k Zillow NYC actives), HIGH MOTIVATION
  43 (4% of tracked), AVG PRICE DROP 7.0%, AVG DOM 72. Footer states the compliance
  posture (robots-allowed paths, 5s pacing, CAPTCHA hard stop, Realtor.com excluded)
  and that the data is a *sample*, not full-market coverage. The 1,011/22.8k/4.4%
  figures agree with `/api/health` to the digit.
- **`/trends`** — the ingestion card and the prose do not contradict each other:
  "2 snapshot dates in this 30-day window" is consistent with `snapshot_days: 2`.
- **`/data`** — first rows read `5639 NETHERLAND AVE APT 1B / 10471 / co-op / $99,000 /
  847 / 37.7% / $133 / High`, a real Zillow listing with a coherent DOM and drop.

**No lorem ipsum, no placeholder copy, no TODO/FIXME text** anywhere in the rendered
output. Copy is specific and matches the brief's claims.

---

## 8. Findings table

Ranked blocker → should-fix → cosmetic. "Repro" is the shortest path I used.

| # | Severity | What | Repro | Evidence |
|---|---|---|---|---|
| — | **blocker** | *none found* | — | — |
| **S1** | should-fix | Map markers are not keyboard-reachable; a keyboard user cannot open a listing from `/map` at all | Load `/map`, press Tab repeatedly — focus never lands on a pin | `pins: 34, tabIndex: null, role: null, ariaLabel: "Map marker", focusablePins: 0`; marker outerHTML `div.maplibre-pin` with no `tabindex` **[prod]** |
| **S2** | should-fix | A shared link carrying `zip`/`type`/`min_price`/`max_price` renders on `/` with **no controls for those filters** | Open `/?score=High&min_dom=120&zip=11215,11216&type=house&min_price=500000&max_price=900000` | `shownBar: "0 of 1011 shown"`, `hasText:false, hasNumber:false, hasSelect:false`, buttons are only `High, Medium, Low, Reset`; screenshot `qa-home-1280-deeplink.png` **[prod]** |
| **S3** | should-fix | No `og:*` / `twitter:*` / canonical tags | Fetch `/`, inspect `<head>` | `og: {}` on all 4 routes; `app/layout.tsx` L7–11 has only `title`+`description` **[prod + source]** |
| **S4** | should-fix | Contrast below AA in 5 places, worst 2.10:1 | Inspect the "Medium" pill on `/`, the `/map` hint line, any `.eyebrow` | `#ffffff` on `#e6a817` = 2.10:1; `#52525c` on `#09090b` = 2.58:1; `#71717b` on `#141416` = 3.81:1; `#71717b` on `#09090b` = 4.12:1; `#d62728` on `#141416` = 3.66:1 **[prod]** |
| **S5** | should-fix | The DOM range slider and the `Type` select have no accessible name; 9 labels lack `htmlFor` | `/map`, query `label:not([for])` and the inputs they precede | 5 unnamed controls on `/map` and `/data`; `Filters.tsx` L38–116 **[prod + source]** |
| **S6** | should-fix | Tap targets below 24px, worst the 13×13 score checkboxes | Tap the score checkboxes on `/map` @390 | 14–19 sub-24px targets per page **[prod]** |
| **S7** | should-fix | `/data` @390 clips 4 columns with no scroll affordance | Load `/data` @390, look at the table | wrapper `519 > 356`; `max-h-[calc(100svh-260px)] overflow-auto` **[prod]** |
| **S8** | cosmetic | `?score=Bogus` silently widens to **all** scores instead of erroring | `/map?score=Bogus&min_dom=abc` → 0 boxes checked, all 160 shown | deliberate per `useFilters`; not disclosed in UI **[dev]** |
| **S9** | cosmetic | `?page=3` when only 2 pages exist: URL says 3, screen says "Page 2 of 2" | `/data?score=High&min_dom=90&sort=days_on_market&dir=-1&page=3` | pager "Page 2 of 2", 18 rows — correct data, disagreeing URL **[prod]** |
| **S10** | cosmetic | One `/trends` chart wrapper scrolls 20px horizontally at 390 | Load `/trends` @390 | `div.mt-2.overflow-x-auto 344 > 324` **[prod]** |
| **S11** | cosmetic | 326 kB first-load JS on `/` and `/map` | `next build` route table | Page 3.72 kB / First Load 326 kB **[prod build]** |
| **S12** | environment | Transient Neon timeout downgrades the whole site to the frozen 82-row sample, no retry | 12 concurrent `/api/health` | 4/12 returned `live:false, tracked:82`; log `ConnectTimeoutError … 10000ms`. Disclosed by the UI **[dev]** |

### Findings that are *not* findings

- `/api/listing/[id]` returning `200 {history: [], unavailable: true}` — deliberate; the
  panel renders "price history unavailable — the history view is not granted yet" and
  the map is unaffected. **Excluded per the brief.**
- `Cannot find module './897.js'` 500s on every route — Next.js dev-mode chunk
  corruption caused by a **second server on port 3300 sharing `site/.next`**, not a
  source defect. A clean isolated `next build` compiles, type-checks and lints clean and
  serves all routes 200. **S12/§6.4, not a product bug.**
- `score=High,Medium&min_dom=60` = 133 rows (UI) vs 160 (my first probe) — my probe
  double-encoded `%2C` via `encodeURI`, which the API correctly treated as a garbage
  score list and widened to all scores. 133 is correct: High 43 + Medium(≥60) 90 = 133,
  + Low(≥60) 27 = 160. This incidentally **confirms S8**.

---

## 9. What I did NOT verify

Stated plainly, so nothing here is mistaken for a pass:

1. **`vw_listing_history` granted.** The view does not exist in Neon, so the *populated*
   price-history panel (sparkline with real points, the recorded reductions list) was
   never rendered. I verified the **unavailable** state only. 1.2's headline feature is
   therefore **unproven against real data**.
2. **`is_active` / `last_seen_at`.** The proper 1.1 fix (schema columns, `STALE_RUNS=3`
   flip) is not applied; I verified the recency-guard fix only. The per-listing
   "last seen N days ago" label reads "today" for every row at the default
   `window_days=0`, so **the label's informative branch is unreachable in normal
   operation** and was not exercised.
3. **Cross-browser.** Chromium only (both chrome-devtools MCP and Playwright). No
   Firefox/Safari/WebKit pass.
4. **Real screen reader.** No NVDA/JAWS/VoiceOver run. The label findings are from
   programmatic accessible-name computation, which is the same algorithm ATs use but is
   not a substitute for an AT pass.
5. **Real touch input.** Tap-target sizes were measured from layout boxes. I did not
   perform real finger taps at 390 — the "miss rate" of the 13×13 checkboxes is inferred
   from size, not from observed mis-taps.
6. **`prefers-reduced-motion` / forced-colors.** Not tested.
7. **The `/map` panel opened by a real pointer click in the production build.** I
   verified this in the **[dev]** session (coordinate click + retry, hit-testing, real
   Close) but in the [prod] pass a synthetic `element.click()` on a marker did not open
   the panel. I could not determine whether that is a measurement-method limitation or a
   production difference. **Treat the prod map panel as verified-by-DOM only.**
8. **CLS / Lighthouse.** The CLS figures I have (`/trends` @390 **0.489**, `/` @1280
   0.329, `/map` @1280 0.011, `/data` @1280 0.044) come from the **corrupted [dev]**
   session where HMR chunk 404s meant hydration never completed. A separate 8.4s poll
   showed the health card's own height constant (351px @1280 / 387px @390), so the card
   does **not** self-shift — the shifts come from the KPI `dl` / hero stat row above it
   resolving. **These numbers should be re-measured on the deployed site before they are
   quoted.** No Lighthouse run completed.
9. **Deployed site.** Everything here is a local production build. Vercel cold-start
   behaviour, edge caching and real Neon latency from Vercel are untested — and the
   roadmap says the SQL migration has not been applied to production.
10. **1.3 brief asked specifically for `page=3` to reproduce.** With
    `score=High&min_dom=90` there are only **2 pages**, so "reproduce page 3" is
    unsatisfiable for that filter set; the control (133 rows → 6 pages) does round-trip,
    and `?page=99999` correctly clamps to "Page 6 of 6" with 8 rows. I verified
    `page=1`, `page=2`, `page=99999` and hostile values; I did **not** verify an
    in-range `page=3` on a 6-page set.
11. **Concurrency/load behaviour** of the app itself (not the transient above) — no
    load test beyond the 12/42 concurrent `/api/health` probes.

---

## 10. Session notes (environment, not product)

1. A **second Next server ran in `site/` on port 3300** throughout (`next dev -p 3300`,
   then `next start -p 3300`), sharing `site/.next` with anything I started. That
   produced: dev-mode `MODULE_NOT_FOUND './897.js'` 500s across all routes, one
   `next build` failure (`Invariant: no direct app page entry found for /_not-found`),
   and 500s on `/`,`/data`,`/map`,`/icon.svg` from a `next start` that shared the
   directory while `/trends` and `/api/health` happened to work.
2. `site/shots/` gained files I did not write during the session, and previously written
   files changed size — a second writer is active in this workspace. **The freeze the
   brief assumed did not fully hold**, so treat any measured count as a snapshot of
   2026-10-16 ~16:00–17:00.
3. To get uncontended numbers I copied `site/` (excluding `.next`, `node_modules`,
   `shots`) plus a full `node_modules` copy to
   `%TEMP%\opencode\qa-site`, built and started it on **port 3111**, measured
   everything there, then killed it and deleted the temp directory. The repository was
   never modified; the only files I added are screenshots and this report.
4. All servers I started are stopped (ports 3000/3111/3300: no listeners) and my log
   files (`site/dev.log`, `site/build.log`, `site/prod.log`) are deleted.
