# Roadmap — Off-Market Radar NYC

Status: **Tier 1 built, verified, and deployed** — see "Build status — Tier 1"
below. Recorded 2026-10-16.
Owner: website / product stage. Supersedes nothing — `docs/websiteplan.md` remains
the V1 build plan; this file covers what comes next.

---

## Why this order

The pipeline's scarce asset is not the listings — Zillow has those. It is the
**daily history**: one `listing_snapshots` row per listing per calendar day,
accumulating forever (see `sql/schema.sql`).

The website currently displays a *single snapshot* of that history. So we are
sitting on a time series and showing a photograph. A client paying for a **daily**
radar has one question we cannot yet answer: *what changed?*

The tiers are ordered by what protects the demo first, then what differentiates
it, then what retains the user:

| Tier | Theme | Why it comes here |
|---|---|---|
| 1 | Credibility | Three of these are arguably bugs. Tier 2 built on top of them would lie. |
| 2 | Differentiation | Makes the accumulated history *visible* — the actual product. |
| 3 | Retention | Turns a site you visit into a service that comes to you. |

Guiding constraint carried over from V1: **keep the scoring explainable.** No
black-box model, no score the client cannot argue with.

---

## Tier 1 — Credibility (do first)

### 1.1 Fix stale listings + surface "last seen"

**Problem.** `vw_latest_listings` returns each listing's most recent snapshot with
no recency filter, and `/api/deals` reads it unfiltered
(`site/lib/db.ts`, `DEALS`). There is no `is_active` / `delisted_at` column in
`sql/schema.sql`. So when a home sells or is delisted it simply stops receiving
snapshots — and its last one stays on the map forever, indistinguishable from a
live listing.

**Evidence (2026-10-16).**

| | |
|---|---|
| Rows returned by the map / CSV | 1,019 |
| Listings in the latest snapshot | 1,011 |
| Already stale (shown on yesterday's data) | 8 |

That 8 grows every day. After a month there would be hundreds of sold homes
pinned on the map.

**Fix, minimal.** Filter the deals query to the current snapshot date, or a short
window (e.g. `snapshot_date >= CURRENT_DATE - 1`). Add a `last_seen_at` /
"last seen N days ago" display so freshness is visible per listing.

**Fix, proper.** Add `is_active boolean` (default true) to `listings`, set false
when a listing misses *N* consecutive runs, and expose it through
`vw_latest_listings`.

**Bonus signal.** Listings *vanishing* from the feed is genuine market
intelligence (sell-through / absorption). Worth capturing rather than discarding.

Effort: **small**. Touches `site/lib/db.ts`, `dashboard/views.sql`,
`sql/schema.sql`, and the map/data surface.

### 1.2 Property detail panel with real price history

**Problem.** We store `price`, `previous_price`, `price_reduced`,
`days_on_market`, `price_per_sqft`, `price_drop_pct` and `motivation_score` per
listing **per day** — and display none of that history. It is the most persuasive
asset in the product and it is invisible.

**Fix.** Clicking a pin or table row opens a panel with a price-history
sparkline, every recorded reduction with its date, current DOM, $/sqft, the
motivation reason, last-seen, and an outbound link to the source listing.

A seller who cut $50k → $25k → $25k over 60 days tells a story no single snapshot
can.

Effort: **medium — no new data collection required.** Needs a per-listing history
endpoint (e.g. `/api/listing/[id]`) reading `listing_snapshots`, plus one new
component.

### 1.3 Shareable filter links

**Problem.** Filters live in component state (`site/lib/useFilters.ts`), so any
view is unshareable. A client cannot send "the 12 Highs in 11215 over 120 days"
to a colleague or to their phone.

> **Correction (2026-10-16, during the Tier 1 build).** The premise above is
> wrong: `useFilters` has been URL-backed since V1 — it hydrates every filter
> from `useSearchParams` and writes back with `router.replace`, and `/map`,
> `/trends` and `/data` all share it. The core of 1.3 was therefore already
> done. Three real defects were found by audit and fixed instead; see "Build
> status — Tier 1". The paragraph is kept because the *intent* below (one
> shareable view) is still the goal.

**Fix.** Serialise filter state into the URL query string and hydrate from it.
The map, trends and data pages already share `useFilters`, so this lands once.

Effort: **small**. High workflow payoff.

### 1.4 Ingestion health card

**Problem.** The daily job is invisible. When the trend line has a gap, nothing
explains why — and a failed run currently looks like the site is broken.

**Fix.** A small card showing: last successful run (`pipeline_runs`), next
scheduled run (cron `0 10 * * *` UTC), coverage (`MARKET_REFERENCE` denominator),
and runs succeeded / failed. This pre-empts "why is there a hole in the chart?"
and advertises the compliance discipline rather than hiding it.

Effort: **small**. Data already exists in `pipeline_runs` and the deployment is
already gated on it.

---

## Build status — Tier 1 (2026-10-16)

Built on branch `main`, deployed, and migrated. The site shipped first (CLI,
2026-10-16), then the SQL migration ran on the production Neon branch the same
day (~13:55Z) in the documented order: column → `dashboard/views.sql` → the
four-object `GRANT`. Apply order, post-apply figures, and the two hazards that
make the order matter: `docs/apply_tier1_migration.md`.

**Deploy automation (2026-10-17).** A `git push` to `main` now deploys
production automatically through the Vercel GitHub App, and branches build
preview deployments gated by Vercel Authentication. Mechanics and evidence:
`README.md` § Deploy mechanics.

**1.1 — stale listings + freshness.** The bug fix is a recency guard in
`site/lib/db.ts` that keeps only the newest snapshot cohort. Measured on
production: **1,019 → 1,011 rows**, the 8-row difference being the listings whose
newest snapshot is not the newest cohort. Scope, stated honestly: those 8 are all
`Low`, so the *default* map filter was never showing them; the inflation was in
the unfiltered surface, the totals and the CSV. The proper fix also landed —
`listings.is_active` (+ `last_seen_at` through `vw_latest_listings`), set true by
the loader's upsert and flipped false after `STALE_RUNS = 3` consecutive missed
successful runs. The guard is deliberately a no-op while fewer than 3 successful
runs exist, because with too little history there is no honest way to separate
"gone" from "not scraped this time". Applied in production, `is_active` reads
`active=1019 inactive=0`, which is correct at two successful runs.

*Decision taken:* on the trade-off between removing the stale rows and keeping the
per-listing "last seen N days ago" label meaningful, the label won. The default is
now `window_days = 1`, so a row's date is no longer *always* the newest snapshot and
the label carries information again. Consequence, stated plainly: the unfiltered
surface and the CSV return **1,019 rows — 1,011 from the newest cohort plus the 8
carried-over rows** the `window_days = 0` guard had been hiding. Those 8 are all
`Low`-motivation and are now **visibly marked as carried over** in the table rather
than silently presented as current. The alternative, `window_days = 0`, still returns
exactly 1,011 rows, so both cohorts remain reachable through the filter. `window_days`
is a live query param, so this is a one-constant change rather than a redeploy — the
revert is equally cheap.

*Where that is visible, exactly:* `score` itself defaults to `High,Medium`, and all 8
carried-over rows are `Low`, so the **default view is unchanged by this flip — 157
rows, every one of them from the newest run, every label still reading "today"**. The
change shows up only when `Low` is included (explicitly, or by clearing `score`) **and**
the DOM floor is lowered — `min_dom` *also* defaults to `60` and the 8 carried rows have
DOM ≤ 14, so `/data?score=Low` on its own still returns **zero** badged rows. That was
measured against the deployed build after an earlier version of this paragraph named that
URL as the path to them, which was wrong. The shorthand "the label is informative now" should
be read that narrowly: the label becomes informative for precisely the rows that were
carried over, because *that is the only thing that can make a row's date differ from
the newest one* — the informativeness and the visible stale rows are the same fact, not
two features. Under `window_days = 0` there is nothing to label, by construction.

**1.2 — price-history panel.** Clicking a pin, a table row, or a keyboard-focused
row opens a panel with a price sparkline, every recorded reduction with its date,
DOM, $/sqft, the motivation reason, last-seen, and the outbound link. Backed by
the new `vw_listing_history` view and `GET /api/listing/[id]`. No new data
collection. Requires the view *and* its `GRANT` in production, both now applied:
`vw_listing_history` holds 1,093 rows and `/api/listing/145558321` returns
`live:true` with a two-point series. Without the grant the endpoint still degrades
to `{history: [], unavailable: true}` rather than erroring the map.

**1.3 — shareable links.** Already implemented in V1 (see the correction above).
Three genuine defects were fixed instead: (a) an empty motivation selection
silently snapped back to the defaults on reload/share, (b) `?min_dom=abc` parsed
to `0`, silently *widening* the filter, and (c) `/data`'s sort key, direction and
page never reached the URL, so a shared view did not reproduce sort or paging.
The empty-selection semantic is now explicit and identical on client and server:
absent `score` → defaults; present-but-empty → all scores. A "Copy link" control
was added.

**1.4 — ingestion health card.** `GET /api/health` + a card on `/trends` and
`/data` showing last successful run, next scheduled run (`0 10 * * *` UTC),
coverage against `MARKET_REFERENCE` (stated as a sample), 30-day success/failure
tallies, and history depth. It exists to answer "why is there a hole in the
chart?" before the client asks. No new SQL: it reads `pipeline_runs` and
`vw_latest_listings`, both already granted.

**Verification.** Independent backend/data gate: recency-guard arithmetic
reproduced against live read-only Neon, the four SQL files parsed and confirmed
re-runnable, `vw_listing_history` cross-checked column-by-column against the
query that reads it, CSV export diffed against `HEAD` (unchanged), and the
stale-marking predicate falsified — it originally deactivated the whole table on
an empty run history, which is fixed. `pytest` 142 passed,
`dashboard/verify_contract.py` 54/54.

**Known gaps.** `/api/listing` cannot distinguish its failure modes. A listing id
that does not exist comes back as a *successful* empty read (`live:true`,
`history:[]`, and no `unavailable` flag) because the query simply matches no rows
now that the view exists — so "no such listing" looks identical to "this listing
has no recorded history". `unavailable:true` is reserved for the exception path,
and the panel asserts a specific cause for it, so a connection timeout would render
a false explanation. The frozen-CSV fallback echoes `window_days` without applying
it (harmless today: the sample holds one snapshot date). Both are recorded here
rather than silently shipped.

### Post-deploy hardening round (design QA + layout stability)

A design-QA pass on the deployed build raised twelve findings (S1–S12, with measured
values and line numbers, in `jobs/tier1-ui-check/evidence/qa_report.md`) plus one
behaviour follow-up on the "last seen" label. The figures below were measured by the
sessions that made the fixes, against a local production build of this tree; the
*deployed* build is gated separately (`jobs/tier1-deployed-qa/`).

- **S1–S9 fixed, S10 partial, S11/S12 not addressed** — per-finding status with the
  measurement behind each is in `jobs/tier1-ui-fixes/evidence/ui-fixes.md`. Headline
  numbers: the Medium motivation badge measured **2.10:1** and now measures **9.45:1**
  (Low 7.53:1, High 5.02:1), so all five contrast pairs pass AA; the 36 map pins are
  `role="button"` + `tabindex="0"` with Enter opening the panel; unnamed enabled
  controls and orphan labels are at zero. **S10** (the `/trends` wrapper clipping 20 px
  at 390) is partial — padding tightened and a scroll affordance added, but the
  exact-390 overflow could not be measured in this environment. **S11** (bundle weight,
  328 kB) and **S12** (transient-timeout fallback) were left out of scope deliberately
  rather than half-done.
- **Two bugs found after that pass, and fixed.** (a) The panel counted the *same* price
  cut once per snapshot day, because `previous_price` is a persistent column carried on
  every daily row — `455058452` claimed two −6.35% reductions for a single cut. A cut is
  now recorded only on the day whose price differs from the previous day's, which keeps
  genuinely distinct cuts apart (`30776634`: −0.1%, then −4.77%) while collapsing the
  carried-over duplicate. (b) `og:image`, `og:url`, `twitter:image` and
  `rel="canonical"` were all absent; the metadata block now carries `metadataBase` and a
  per-route canonical, and `app/opengraph-image.tsx` renders the card with the built-in
  `next/og` (`/opengraph-image` → 200 `image/png`, 50,028 B) — no new dependency, and no
  binary asset that can drift from the design.
- **Layout stability was a defect, not a nitpick.** All four routes shipped
  `BAILOUT_TO_CLIENT_SIDE_RENDERING` because `lib/useFilters.ts` called
  `useSearchParams()` inside the page body's Suspense boundary, so the served `<main>`
  was 151–155 characters. Because `main` is `flex-1`, the 465 px footer sat inside the
  first screen at 390 px and left the viewport when hydration inserted the page: a
  **0.558** shift, byte-identical on three routes. Worst cells before: `/map` 0.559,
  `/data` 0.560, `/trends` 0.803 at 390; `/trends` 1.025 at 1350. **Lighthouse's mobile
  CLS of 0 was an artefact** — touch emulation marks shifts `hadRecentInput` with no
  input events, so a 0 there was never a pass. The filter state now comes from an
  external store (`lib/useUrlSearch.ts`, `useSyncExternalStore` with a `""` server
  snapshot), so all four routes still prerender (`○ Static`) with **zero bailout
  markers** and no TTFB cost. All twelve cells are now under 0.1; worst remaining is
  0.022. Full before/after and per-fix detail: `jobs/tier1-cls-fix/evidence/cls-fix.md`;
  root-cause attribution: `jobs/tier1-cls-diagnosis/evidence/cls-diagnosis.md`.
- **Left knowingly unfixed, and recorded as such**: map pin *first paint* can be
  unstable — now quantified rather than merely observed (1 load in 6 still had only 2 of
  43 markers drawn 13 s in, with no failed request and the correct API response); two
  19 px-tall inline links remain on `/data` and `/trends`; and the hero `<h1>` is still
  data-gated (~0.019 at 390, under budget, but data-gated). The statement that "no
  automated accessibility run exists" is **superseded** — see the next section.

### The automated gates, and what they refuted (2026-10-17)

The round above was verified by manual measurement, because axe and Lighthouse could not
run in that environment. They run now, and the first automated pass
(`jobs/tier1-deployed-qa/evidence/qa_report.md`) **refuted one claim outright and
corrected two of its own**.

- **The refuted claim was a live correctness bug.** `/trends?score=High&min_dom=90`
  rendered the *default* cohort (133 rows) instead of the deep-linked one (43) in most
  runs. Cause: the CLS fix's external store returns `""` on its first render, so every
  filter-aware fetch fired twice — once against the SSR default, once against the
  reader's query — and `/trends` was the only one of the three pages without a staleness
  guard, so the stale response won. Fixed by exposing the store's `ready` flag
  (`useUrlSearchReady()`) and gating the first fetch on it **and** adding an
  `AbortController` guard to all three pages. Re-proved with six consecutive loads per
  route: `/trends` reads 43 six times out of six, with **exactly one `/api/deals` request
  per load** — the wasted request is gone, not merely losing the race. Detail:
  `jobs/tier1-gate-fixes/evidence/gate-fixes.md` §1.
- **The accessibility claims above were overstated, and were fixed rather than
  softened.** axe (4.10.2) found `/trends` `svg-img-alt` **serious ×78 nodes**,
  `empty-table-header`, an unnamed SVG control, and `/map` `heading-order` (h1 → h3).
  All are now fixed — chart summaries as `sr-only` text with the SVG `aria-hidden`,
  `rootTabIndex={-1}` on the pie (recharts defaults it to 0, which had turned the
  78-node violation into one `aria-hidden-focus`), an `sr-only` name in the empty `<th>`,
  and the footer headings promoted to h2. Every route × width cell is now **0
  violations, 0 serious/critical**, and the summaries carry the real series values, so
  nothing was silenced to get there. This is axe-only: it is not a screen-reader pass,
  and none has been done.
- **Two gate premises were wrong, and measuring beat "fixing".** The gate reported pins
  at 23×24; an `elementFromPoint` sweep that scrolls each pin into view and reports both
  the integer and the sub-pixel box measured **24×24 / 24.5×24.5** on twelve leaves, so
  the CSS was left alone — the 23 was a probe artefact. And the carried-over badge path
  the gate named (`/data?score=Low`) yields zero badged rows because `min_dom` also
  defaults to 60; the rows need `Low` *and* a lowered DOM floor.
- **A fix in this round introduced a regression, and the re-run caught it.** The
  `sr-only` name added to the table's empty `<th>` is `position: absolute` with no
  positioned ancestor, so its containing block sat *outside* the `overflow-x-auto`
  wrapper — and a scroll container does not clip such a descendant. It escaped the clip
  and took `/trends` from `scrollWidth` 390 to **491** at 390 px (a 101 px horizontal
  scroll, and the likely cause of one flaky 0.153 CLS reading). Fixed with `relative` on
  the cell and re-measured at 390. `jobs/tier1-gate-fixes/scripts/overflow-probe.js`
  exists so the next person can find this class of bug in one command.
- **SEO gaps closed**: `robots.txt` and `sitemap.xml` were 404s, and all four routes
  shared one `<title>` and description. Both files now exist (no new dependency) and each
  route has its own title and description with its canonical unchanged. `favicon.ico` and
  `manifest.webmanifest` remain 404 deliberately — one needs a binary, the other a
  dependency, and neither is load-bearing here.
- **CLS was re-verified after every change, not once**: all twelve cells under 0.1, worst
  **0.0189** (`/@390`), `hscroll=false` and zero console/network errors in every cell.

### Live round: the same gates re-run against the deployment (2026-10-17)

Every number above was measured against a **local** production build. The fixes were then
deployed (`dpl_2RjajPjG5rtqENnnzjQEDPEwzjWe`, aliased to
`https://off-market-radar-nyc.vercel.app`) and the whole harness re-run against the live
URL, so the claims now rest on the deployed artifact rather than on a local build of the
same tree. One previously **untested** path was added, and one contradictory reading was
resolved.

- **The race fix holds on the deployment.** 20/20 loads across `/trends` and `/data` at
  both 390 and 1280 (cold path included) rendered the deep-linked cohort — 43 rows for
  `?score=High&min_dom=90` — with exactly one `/api/deals` request per load.
- **Back/forward and cross-page navigation were never tested at all** (`popstate.js`).
  They are consistent: setting the DOM slider to 90 in the UI writes
  `?score=High,Medium&min_dom=90` and renders 122 of 1011; `history.back()` leaves the
  site and `history.forward()` restores that exact state (122, slider 90); navigating to
  `/data` and back re-derives defaults from the now-empty URL (133 rows) rather than
  serving the stale cohort; and a fresh deep link to `?min_dom=90` renders the
  **same** cohort as the UI-driven one (`uiMatchesDeepLink: true`). Five loads, five API
  requests, zero console errors. One design fact made explicit: filter writes go through
  `router.replace`, so a filter change does **not** create a history entry — the URL is
  shareable, but `back()` is page-level, not filter-level.
- **No horizontal scrolling anywhere, on any route, at any width.** The `sr-only`
  regression is gone on the deployment: `documentElement.scrollWidth == innerWidth` and
  `scrollTo(9999, 0)` moves 0 px at `/`, `/map`, `/trends`, `/data` × 390/768/1280 (nine
  cells). The tables on `/trends` and `/data` still render ~500–600 px wide at 390, but
  inside their `overflow-x-auto` wrappers, which is the intent — the page does not scroll.
- **A contradictory reading was resolved by measuring rather than choosing.** The pins
  probe reported `docWidth=411` at `/map@390` while CLS reported `hscroll=false` at the
  same cell. `scrollprobe.js` measured the map at 390 on the live site:
  `scrollWidth=390`, and the window cannot scroll horizontally. The 411 was a transient
  reading inside the leaflet container, not a scrolling page.
- **Pins re-measured on the deployment: 23.9 × 24.4** visible area over twelve leaves —
  consistent with the 24×24 local reading and confirming that the gate's 23×24 was a
  probe artefact. The CSS was left alone.
- **axe re-run live: 0 violations, 0 serious/critical on all eight route × width cells**,
  `unnamedControls=0`, `emptyTh=0`, heading sequences sequential on every route.

### Takeover round: two QA nits closed, one more CLS defect fixed (2026-10-17)

The two subagents still listed as running were reclaimed rather than waited on: `design-qa`
returned a full verdict on takeover (all six of its findings verified; its **pin hit-area**
finding refuted — the leaves measure 24.5 × 24.5 on 12/12, and the 23 × 24 was the probe's own
artefact, so no CSS changed), and the general fix session had been dead 11 hours with its work
already merged. Two nits it raised were fixed, plus one defect found while measuring them.

- **The header nav dropped the filter.** `/trends` promises *"Reflects the current map filters"*,
  but the static header links were bare paths, so navigating by header silently reset the cohort
  (43 → 133). New client component `site/components/FilterNav.tsx` carries the query on the three
  explorer links; verified live — clicking Trends lands on `IN FILTER: 43`.
- **`/trends` claimed "0 listings shown" while loading**, and a *failed* fetch claimed zero too.
  Three states now: `…` while loading, the count when loaded, `!` / *"Couldn't load listings"* on
  error — with the 7 `sr-only` chart summaries saying *"loading."* / *"couldn't load the
  listings."* rather than *"no data in the current filter."* Six assertions, all true, live and local.
- **Two CLS defects, one pre-existing, both fixed** (`jobs/tier1-gate-fixes` §11). The
  `Freshness` strip is 78 px loading, 118 px live and ~464 px with its detail line and frozen pill,
  while the header's first row gives it only **135 px** at 390 — so a frozen (`live:false`)
  fallback wrapped the row, pushed `<main>` down 28 px and cost **0.1466 CLS**; the same wrap from
  the detail line cost **0.317** at 640–830 in the *normal* path, which the gate never measured
  because its CLS cells are 390/1280/1350. Fixes: the frozen state folds into one date-carrying
  pill below `lg` (the badge is folded, not dropped — `/map` has no other frozen indicator), the
  wrapper is `max-w-[130px] truncate` below `lg` so it can never reflow that row again, and the
  detail line now appears from **1024 px** up, the first breakpoint above the band.
  **Measured: 0.00190 and 0.00119/0.00099 respectively, on the deployed build.** Disclosed
  trade: between 640 and 1023 px the header no longer shows the tracked/High/source detail.
  Tablet widths should be added to `cls.js` — that gap is why 0.317 went unnoticed.

---

## Tier 2 — Differentiation

### 2.1 "Changed today" feed + pin badges

**Why it matters.** This is the feature that makes the daily pipeline *visible* to
a client instead of invisible infrastructure, and it is only possible because the
history exists. A **second** price cut is a far stronger motivation signal than a
first one — and no single-snapshot competitor can detect it.

**Signals worth surfacing.**

- **Cut again** — 2nd or later reduction (strongest detector we have)
- **New High** — a listing crossed into High motivation since the last run
- **Crossed 90 days** — entered the stale zone
- **Back on market** — reappeared after an absence (see 1.1's vanish signal)

**Fix.** Compare the latest snapshot against the previous one per listing.
Consider a `vw_listing_deltas` view so the API stays a thin read, and badge the
map pins plus a "changed today" list on the landing page.

Effort: **medium**. Backed entirely by `listing_snapshots`.

### 2.2 Under-priced flag — $/sqft vs ZIP median

**Why it matters.** Today the product answers "is this seller motivated?". It
does not answer "is this a *good deal*?". Those are different questions and the
second is the one a client acts on.

**Fix.** Compute a ZIP-level median $/sqft, then flag listings materially below
it ("12% under the median for 11215"). Keep it explicit and computed in SQL so
the number is auditable.

**Data already available:** 892 rows carry `price_per_sqft` across 157 ZIPs.

Effort: **small–medium**.

---

## Tier 3 — Retention

### 3.1 Watchlist + daily email digest

Saved filters (per email address) plus a digest: *"3 new Highs in your ZIPs since
yesterday."* This is what converts a site someone visits into a service that comes
to them — and it reuses Tier 2's delta machinery.

Note: this is the point where V1's "no login" decision is revisited. A digest can
ship **without** accounts (email + tokenised link), which defers the auth
attack surface.

### 3.2 Map ↔ list sync, and a drive sheet

Selecting a pin selects its row and vice-versa; panning the map re-scopes the
list. Plus a print-friendly "drive sheet" for a day of showings. Quality-of-life
for the actual Tuesday-morning workflow.

---

## Deliberately excluded

Recorded so they are not mistaken for oversights:

| Idea | Why not |
|---|---|
| Rent / yield math | Needs rent data we do not have. Faking it would be the first dishonest number in the product. |
| True pre-MLS off-market inventory | Needs a licensed MLS feed. "Off-market" here means *pre-competition*, not *pre-MLS*. |
| Accounts in V1 | Adds an auth surface to a product whose demo works without one. See 3.1 for the account-free digest. |
| Any anti-bot escalation to raise coverage | Out of bounds by project rule: robots-allowed paths, 5s pacing, hard stop on any CAPTCHA. Coverage stays a sample until a licensed source replaces the scrape. |

---

## Dependencies and sequencing

- **Tier 2.1 depends on Tier 1.1.** A change feed computed over stale rows will
  report changes for homes that are no longer for sale — it would lie, daily, in
  the most visible part of the UI.
- **Tier 2.x should ship with a `vw_listing_deltas` view** rather than ad-hoc
  comparisons in the API layer.
- **Tier 3.1 reuses Tier 2.1.** Build the delta detection once.
- **Scoring stays explainable** (project rule). If 2.2 changes the score, it must
  stay a rule a client can read, not a weight vector.

## Recommended order

1. ~~**Tier 1**~~ — **built, deployed, and migrated 2026-10-16** (see "Build
   status — Tier 1"). Three quarters of it was small, and 1.1 turned out to be
   closer to a bug than a feature.
2. **Tier 2.1 change feed** — the headline feature; makes the daily pipeline the
   visible product.
3. **Tier 2.2**, then **Tier 3** as retention becomes the constraint.
