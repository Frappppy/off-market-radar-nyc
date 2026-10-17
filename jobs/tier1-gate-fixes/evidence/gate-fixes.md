# Gate fixes — the independent QA pass on the deployed Tier 1 build

**Job:** close every defect the independent `design-qa` gate found when it re-tested the deployed
Tier 1 build (`jobs/tier1-deployed-qa/evidence/qa_report.md` — 10 of 13 claims VERIFIED, 1 REFUTED,
2 PARTIAL), and re-test the fixes with measurement rather than assertion.

**Verdict up front:** the refuted claim was a real, live correctness bug and is fixed and re-proved.
Both partials are closed. Two of the gate's premises turned out to be wrong (the pin hit area and
the badge path), one of which I had already queued as a "fix" before measuring it — and fixing a
phantom would have risked a property that was already correct. One **new** regression was introduced
*by the fix for the empty table header* and caught by re-running the CLS sweep; it is fixed.

## Build identity

| | |
|---|---|
| Repo HEAD | `de0f291` (the gate-fix work, committed and pushed) |
| Deployed | `dpl_2RjajPjG5rtqENnnzjQEDPEwzjWe` → `off-market-radar-f1wxct749`, aliased to `https://off-market-radar-nyc.vercel.app` |
| Local target | `next build` + `next start -p 3222` from `site/` |
| Live target | §9 re-ran the harness with `BASE=https://off-market-radar-nyc.vercel.app` |
| typecheck | `npm run typecheck` → exit 0 |
| build | `npm run build` → exit 0, all four routes `○ (Static)` (the F1 property is intact) |
| Known warning | `jiti` "Critical dependency: the request of a dependency is an expression" via `lib/db.ts → @neon/config` — pre-existing, not from this work |

## Scripts

All in `jobs/tier1-gate-fixes/scripts/`, run with `node <script>.js` and `BASE` (default
`http://localhost:3222`), `TAG`, `OUT` (default `C:\Users\omisg\AppData\Local\Temp\opencode\gate\out`).
Harness: `playwright-core` from the local MCP install, Chromium 1228, viewport via CDP
`Emulation.setDeviceMetricsOverride {mobile:false, dsf:1}` with touch emulation explicitly disabled,
CLS instrumented by `jobs/tier1-cls-diagnosis/scripts/cls-init.js`.

| Script | Measures |
|---|---|
| `lib.js` | shared `launch()` / `cell()` (CDP viewport, console + failed-request + 4xx capture, `/api/deals` request log) |
| `deeplink.js` | the deep-link cohort count and the exact `/api/deals` request sequence per load |
| `axe.js` | axe 4.10.2 per route × width, plus a headings / `role=img` / unnamed-control / empty-th inventory |
| `cls.js` | 12 cells (4 routes × 390/1280/1350) of CLS + console + network |
| `pins.js` | pin hit area by `elementFromPoint` sweep unless it trusts nothing — integer box, sub-pixel box, per-axis reach, leaf gaps |
| `pin-diag.js` | pin sampling diagnostics |
| `seo.js` | `/robots.txt`, `/sitemap.xml`, `/favicon.ico`, `/manifest.webmanifest`, per-route title/description/canonical/OG counts |
| `overflow-probe.js` | every element whose real box exceeds `innerWidth` (added by this session) |
| `repeat-cell.js` | repeat a single cell N times, local or against any `BASE` — used as the control experiment (added by this session) |
| `popstate.js` | **back/forward and cross-page navigation**: UI filter change → URL, `history.back()/forward()`, SPA nav away and back, then the same cohort as a deep link — checking the rendered cohort matches the URL at every step (added by the live round) |
| `scrollprobe.js` | **the scroll question, decided**: `documentElement.scrollWidth`, whether `scrollTo(9999,0)` actually moves, and the widest visible elements — per route × 390/768/1280 (added by the live round) |

## 0. The session that started this died mid-edit

The first fix session hit a provider rate limit and terminated with `state=error`. It had, however,
finished the expensive part and left the tree in a state that **did not compile**:

- **Complete:** the seven scripts above (the whole measurement harness), and the race fix —
  `ready` in `site/lib/useUrlSearch.ts` + `useUrlSearchReady()` consumed by `app/trends/page.tsx`,
  `app/data/page.tsx` and `components/Explorer.tsx`, each with an `AbortController` staleness guard.
- **Broken:** `app/trends/page.tsx` was edited between two steps. `ChartCard` had gained a
  *required* `summary: string` prop and the `sr-only` text-alternative paragraph, but all seven
  call sites were still un-annotated and the `pctText` / `sentence` helpers written for them were
  unused. `npm run typecheck` failed with **7 × TS2741**, and nothing downstream (build, deploy,
  verification) could run.
- **Not started:** `robots.ts` / `sitemap.ts`, per-route titles, `/map` heading order.

This session closed the file using the helpers the dead session had written for exactly that
purpose, then did the un-started items. The dead session's design was sound; only its last edit was
incomplete. **No claim in this report rests on the dead session's unverified output** — every number
below was re-measured on a build that typechecks.

## 1. REFUTED claim — the `/trends` deep-link race (live correctness bug)

**Original finding:** `/trends?score=High&min_dom=90` showed **133** (the default cohort) in 3 of 4
runs, 43 in the fourth. The network log showed the default `score=High,Medium&min_dom=60` response
resolving *last* and overwriting the deep-linked result.

**Root cause:** the CLS fix (F1) replaced `useSearchParams()` with an external store, and the store's
first render necessarily returns the SSR placeholder `""`. So every filter-aware fetch effect ran
twice: once against the server-snapshot default cohort, then against the reader's real query. Both
responses were in flight together. `app/trends/page.tsx` was the only one of the three filter-aware
pages with **no staleness guard**, so the stale response won and the page silently rendered the wrong
cohort. It is intermittent, which is why it survived a casual check and why the gate was right to
follow it up rather than write it off.

**Fix (both halves, deliberately):**
1. `site/lib/useUrlSearch.ts` state is now `{ search, ready }`; `ready` is `false` until the store
   has actually observed `window.location`, and `useUrlSearchReady()` exposes it. All three
   filter-aware pages `return` early while `!ready`. This removes the spurious request *and* the
   race window — the preferred fix, because racing around the bug leaves the wasted request.
2. Each of those effects also holds an `AbortController` and aborts on cleanup / re-run, matching
   `Explorer.tsx` and `data/page.tsx`. **Not** relying on (1) alone: a late response must not be
   able to overwrite a newer one under any ordering.

**Proof — 6 consecutive loads per route** (`TAG=gatefix`, `deeplink.js`, 13 s settle, 1280×900):

```
/trends?score=High&min_dom=90   -> ["43","43","43","43","43","43"]
    every run: apiCalls=["/api/deals?score=High&min_dom=90&limit=500"]   (exactly ONE request)
/data?score=High&min_dom=90     -> ["43 shown","43 shown",... x6]  csv="Download 43 rows as CSV"
/map?score=High&min_dom=90      -> ["43 of 1011 shown" x5, "2 of 1011 shown" x1]  (see §7)
```

The single `apiCalls` entry per load is the stronger result: the default-cohort request is **gone**,
not merely losing a race. Re-checked after the final rebuild (`RUNS=3`): `/trends` 43/43/43.

Raw: `gate\out\deeplink-gatefix.json`, `deeplink-gatefix.log.txt`, `deeplink-gatefix2.*`.

## 2. Accessibility — axe is clean, and nothing was silenced

**Before** (axe 4.10.2, 390 + 1280):

| Route | Violations |
|---|---|
| `/trends` | `svg-img-alt` **serious ×78 nodes**; `empty-table-header`; 1 unnamed SVG `<g>` control |
| `/map` | `heading-order` (h1 → h3, no h2) |
| `/`, `/data` | clean |

**Fixes:**
- Charts: each `ChartCard` takes a `summary` and renders it as an `sr-only` paragraph; the SVG is
  `aria-hidden` because that text is its equivalent. **The information is not lost** — the summaries
  state the actual series (`pctText` / `sentence` helpers), e.g. "Motivation mix: High 12 listings
  (27.9%); …". Seven summaries written from each chart's own data.
- The `aria-hidden` wrapper initially converted the 78-node violation into **`aria-hidden-focus`
  (serious ×1)**: recharts defaults `rootTabIndex` to **0**, so the pie's root
  `<g class="recharts-layer recharts-pie" tabindex="0">` stayed keyboard-focusable inside a hidden
  subtree — and that same node was the unnamed control. Fixed with `rootTabIndex={-1}` on `<Pie>`
  (the prop exists and is typed: `recharts/types/polar/Pie.d.ts:71`). `-1` = programmatically
  focusable but not tabbable; nothing is lost, the `sr-only` summary is the accessible form.
- `empty-table-header`: the link column's `<th>` gets an `sr-only` name.
- `/map`: the four footer column headings were `h3`, so on `/map` — whose only content heading is the
  `h1` — the sequence jumped h1 → h3. They are footer headings, so `h2` is correct.

**After** (`TAG=gatefix3`, 8 route × width cells):

```
/@390 0  /@1280 0  /map@390 0  /map@1280 0  /data@390 0  /data@1280 0  /trends@390 0  /trends@1280 0
   every cell: serious+critical = 0
/map    headings = h1 -> h2 x4                 unnamedControls=0  emptyTh=0
/trends headings = h1 -> h2 x10 -> h3 x0       unnamedControls=0  emptyTh=0
```

Raw: `gate\out\axe-gatefix.json` (intermediate, includes the `aria-hidden-focus` finding),
`axe-gatefix2.json`, `axe-gatefix3.json`.

## 3. SEO — two 404s closed, four identical titles made distinct

**Before:** `/robots.txt`, `/sitemap.xml`, `/favicon.ico`, `/manifest.webmanifest` all 404;
all four routes served **one identical** `<title>` and description.

**After:** `/robots.txt` **200** (`text/plain`, 147 B, `allow: /` + `disallow: /api/`, sitemap
declared); `/sitemap.xml` **200** (`application/xml`, 782 B, valid `urlset` with the four real
routes); each route has its own title and description. Verified on the **live** build
(`dpl_2RjajPjG5rtqENnnzjQEDPEwzjWe`): `/` → "Off-Market Radar · NYC — Motivated Seller Finder",
`/map` → "Map — Off-Market Radar NYC", `/data` → "Call list & CSV export — …",
`/trends` → "Market trends — …", each with its own canonical, and **OG/Twitter counts unchanged
(11/8)** so the previously verified metadata was not disturbed.

Implementation: `app/robots.ts`, `app/sitemap.ts`, and a thin server `layout.tsx` per route (the pages
are client components and a `"use client"` module cannot export `metadata`). `alternates` is
deliberately not repeated in the child layouts — the root's `canonical: "./"` already resolves per
route.

**Deliberately skipped, and not half-done:** `/favicon.ico` (needs a binary; `app/icon.svg` is
already served and linked at 200) and `/manifest.webmanifest` (needs either a dependency or a static
file, and is not load-bearing for this site).

## 4. PARTIAL — the pin hit area: **the gate's premise was wrong**

The gate reported pins measuring **23×24** ("1 px short in X, not rounded"), so the brief said to fix
the hit area. `pins.js` — designed specifically to *not* trust `getBoundingClientRect`, scrolling the
pin into view before sampling and walking with `elementFromPoint`, reporting the integer hit box and
a sub-pixel box — measured:

```
/trends@390   4 leaves   integerHitBox=[24,24]  subPixelBox=[24.5,24.5]  centreOnPinAll=true
/trends@1280  8 leaves   integerHitBox=[24,24]  subPixelBox=[24.5,24.5]  centreOnPinAll=true
/trends@1350  8 leaves   integerHitBox=[24,24]  subPixelBox=[24.5,24.5]  centreOnPinAll=true
```

The `::before` hit box is a genuine 24×24 (`globals.css` sizes it explicitly at 24×24 with
`margin: -12px`, deliberately square because `border-radius` clips hit-testing). **No CSS was
changed.** The previous round's 23×24 reading is most plausibly a probe artefact — the same class of
error the gate itself found and corrected elsewhere in its report (its 0×0 pin hit-test came from
probing a point below the fold). Changing the CSS for a phantom would have risked a property that
already meets WCAG 2.5.8. The independent gate has been asked to re-measure and say which it is.

## 5. A regression *this session introduced*, caught by re-running the sweep

Adding the `sr-only` name to the empty `<th>` (§2) broke horizontal layout containment:

- `sr-only` is `position: absolute`. The `<th>` had no positioned ancestor, so the span's containing
  block was the **initial containing block — outside the `overflow-x-auto` wrapper**. A scroll
  container does not clip an absolutely positioned descendant whose containing block is outside it,
  so the span escaped the clip, landed at the last column's offset and stretched the document:
  **`documentElement.scrollWidth` 390 → 491** at a 390px viewport (a 101px horizontal scroll on
  `/trends` at mobile width).
- Caught by `overflow-probe.js` after `cls.js` reported `hscroll=true` on that cell. The identical
  501px table overflows its column **by the same 144px in production too** (57 offenders there, 58
  here) — the table was never the problem; only the *containment* differed.
- **Fix:** `relative` on the `<th>`, making the cell the span's containing block so `HScroll` clips it
  again as intended. Measured after: `scrollWidth 390`, `hscroll=false`, and the span is clipped
  (`+69px <span class="sr-only"> w=1` inside the scroll wrapper, document clean).

This is the one defect in this report that did not exist before the fix round. It is recorded here
because a fix that introduces a bug — and a sweep that catches it — is the point of the exercise.

## 6. CLS — all 12 cells under budget, and the flaky 0.153 attributed

One early run reported **`/trends@390 = 0.15293`**, far outside CLS variance against the deployed
0.0189. Rather than accept it or dismiss it, both were measured:

- **Repeat, my build:** `0.00041`, `0.00041`, `0.00041` (3 runs, same cell).
- **Control, production (pre-fix code):** `0.00041`, `0.00041`, `0.00041`.
- So it was **not** a deterministic regression. The most plausible cause is the §5 overflow
  appearing *after* first paint in that particular load (a document that gains a horizontal scrollbar
  shifts its viewport), which is consistent with `hscroll=true` being recorded in that run and with
  the bug being real and now fixed.

**Final sweep on the fixed build (`TAG=gatefix3`), all 12 cells:**

| Route | 390×844 | 1280×900 | 1350×940 |
|---|---|---|---|
| `/` | 0.01889 | 0.00513 | 0.00441 |
| `/map` | 0.00109 | 0.00470 | 0.00404 |
| `/data` | 0.00222 | 0.00671 | 0.00578 |
| `/trends` | **0.00041** | 0.00181 | 0.00156 |

Worst cell **0.01889** (vs the 0.1 budget), `hscroll=false` everywhere, `err=0 4xx=0 fail=0`
everywhere, and `hri=0` with `inputs=0` in every cell — every shift is real, not a
`hadRecentInput` artefact of touch emulation. Raw: `gate\out\cls-gatefix*.json`.

## 7. `/map` run 5 — attributed, not waved away

`/map?score=High&min_dom=90` read `2 of 1011 shown` in 1 of 6 loads. The raw record rules out both
the race and a network failure: `apiCalls=1` (the correct deep-link URL), `failed=[]`, `bad=[]`,
`errs=0`, and the API returned the correct 43. It is the **known slow-marker residual** the earlier
gate quantified (time-to-first-marker 1.3 s → 21.7 s, one outlier logging `net::ERR_CONNECTION_CLOSED`),
now confirmed with a rate: **1 load in 6 still had only 2 of 43 markers drawn at the 13 s sample.**

A second instance of the same *family* appeared after the rebuild: `/data?score=High&min_dom=90` read
`2 shown` in 1 of 3 loads, again with a single correct API call and no errors — i.e. the visible
counter lagged the fetched cohort. Both are rendering/paint latency, not data races, and both are
**out of scope here** (the roadmap records the marker-paint residual; this report adds the counter
case and the 1-in-6 rate rather than re-reporting it as new).

## 8. Reproducing

```powershell
# from the repo root
Set-Location -LiteralPath '...\Project 1 [The Off-Market Real Estate Deal Finder]\site'
npm run typecheck ; npm run build ; npm run start -- -p 3222     # in another shell

Set-Location -LiteralPath '..\jobs\tier1-gate-fixes\scripts'
$env:BASE='http://localhost:3222'
$env:TAG='gatefix3'; node axe.js          # 8 cells, expect violations=0 serious+critical=0
$env:TAG='gatefix3'; node cls.js          # 12 cells, expect worst < 0.019, hscroll=false
$env:RUNS='6'; $env:TAG='gatefix'; node deeplink.js   # expect 43 x6, apiCalls=1 per load
$env:ROUTE='/trends'; $env:W='390'; node overflow-probe.js   # expect docScrollW == innerWidth
$env:BASE='https://off-market-radar-nyc.vercel.app'; $env:TAG='prod390'; $env:N='3'; node repeat-cell.js
```

Traps hit while doing this, worth keeping: `Start-Process -WorkingDirectory` and the background
shell's `workdir` both fail on a path containing `[` `]` (use `Set-Location -LiteralPath` *inside*
the command); a rebuild while `next start` is running needs the server restarted; `node.exe` writes to
stderr, so PowerShell renders CLI banners as `NativeCommandError` noise that is not a failure.

## 9. The live round - the same harness re-run against the deployment

Everything above was measured against a **local** production build. The tree was then
deployed (`dpl_2RjajPjG5rtqENnnzjQEDPEwzjWe`, alias
`https://off-market-radar-nyc.vercel.app`) and the harness re-run with
`BASE=https://off-market-radar-nyc.vercel.app`, so these claims rest on the deployed
artifact. Two scripts were added for this round: `popstate.js` (a path nobody had tested)
and `scrollprobe.js` (to settle a contradiction).

**9.1 The refuted claim holds on the deployment.** 20/20 loads across `/trends` and
`/data` at 390 and 1280 rendered the deep-linked 43-row cohort, one `/api/deals` request
per load, cold path included.

**9.2 Back/forward and cross-page navigation (`popstate.js`) - consistent, and new.**

| step | URL | slider | rendered | api |
|---|---|---|---|---|
| 1 initial | `/map` | 60 | 133 of 1011 | 1 |
| 2 UI sets DOM to 90 | `/map?score=High,Medium&min_dom=90` | 90 | 122 of 1011 | 2 |
| 3 `history.back()` | *(left the site)* | - | - | 2 |
| 4 `history.forward()` | `/map?score=High,Medium&min_dom=90` | 90 | 122 of 1011 | 3 |
| 5 SPA nav to `/data` | `/data` | 60 | 133 rows as CSV | 4 |
| 6 SPA nav back to `/map` | `/map` | 60 | 133 of 1011 | 5 |
| 7 deep link `?min_dom=90` | `/map?min_dom=90` | 90 | 122 of 1011 | 1 |

The invariant held at every step: **the rendered cohort matched the URL**, and the
UI-driven state (step 2) equals the deep-link-driven state (step 7),
`uiMatchesDeepLink: true`. Zero console errors across all seven steps. Five loads, five
API requests — no duplicate or racing fetch on popstate. One design fact, now explicit:
filter writes use `router.replace`, so a filter change creates **no** history entry;
the URL is shareable, and `back()` is page-level, not filter-level.

**9.3 No horizontal scrolling anywhere** (`scrollprobe.js`, nine cells:
`/`, `/map`, `/trends`, `/data`... measured `/map`, `/trends`, `/data` × 390/768/1280).
At every cell `documentElement.scrollWidth == innerWidth` and `scrollTo(9999, 0)` moved
**0 px**. The `/trends` and `/data` tables still lay out ~500–600 px wide at 390, but
inside their `overflow-x-auto` wrappers, which is the intent; the page does not scroll.
The `sr-only` overflow regression from §5 is absent on the deployment.

**9.4 A contradictory reading resolved by measuring, not choosing.** The pins probe
reported `docWidth=411` at `/map@390`; CLS reported `hscroll=false` at the same cell.
`scrollprobe.js` re-measured the live map at 390: `scrollWidth=390`, `canScrollX=0`, and
no visible element whose right edge passed the viewport. The 411 was a transient inside
the leaflet container, not a scrolling page.

**9.5 Pins on the deployment: 23.9 × 24.4** visible area over twelve leaves, matching
the local 24×24 reading and confirming §4's conclusion that the gate's 23×24 was a probe
artefact. CSS unchanged.

**9.6 axe on the deployment: 0 violations, 0 serious/critical on all eight route × width
cells**, `unnamedControls=0`, `emptyTh=0`, heading sequences sequential.

**9.7 The push experiment.** Commit `de0f291` was pushed to
`Frappppy/off-market-radar-nyc` while watching the deployment list: **no deployment was
created** — the newest stayed `f1wxct749`, with `deployments: []` and `hooks: []` on the
project and every historical deployment `Production`-scoped. Push-to-deploy is therefore
provably still unwired, independently of the earlier `vercel git connect` failure. The
outstanding step is the user's: install the Vercel GitHub App on the repo, and connect
*after* pushing, since connecting can trigger a deploy of the newest commit.

**Correction (2026-10-17).** The verdict above is superseded; the observation is kept so
the reversal is on the record. The App was installed on `Frappppy/off-market-radar-nyc`
and the project connected (`GET /v9/projects/prj_lZtIBrfxq0TehcMulRyjF4ijQifY` →
`link.type=github`, `link.productionBranch=main`, `rootDirectory=site`). Push-to-deploy
now works: pushing empty commit `3495fea` to `main` (2026-10-17 08:14:39Z) created
`dpl_9wcKJJhChPefgAfgKrXYa4Xwt478` at 08:14:46Z — `READY`, `target=production`,
`source=git`, no CLI command run — and moved the production alias to
`off-market-radar-80u84hga7-frappppy.vercel.app`; a throwaway branch at a new SHA
(`f1fdea7`) likewise produced a Preview deployment `dpl_8xdcWxYpif62bycKyNKaoY24WhBz`
(`target=preview`) within seconds. The discriminator that settles it is the top-level
`source` (`git` vs `cli`), not `hooks: []` — an App delivers events through its own
installation webhook, so per-repo hooks stay empty while push-to-deploy is live.

## 10. Residuals - not fixed, stated

1. **Marker / counter paint latency** (§7): 2 of 27 sampled loads lagged the fetched cohort at the
   sample point. Not a data race; needs its own investigation (candidate: the map's marker layer and
   the table's row rendering both wait on something after the fetch resolves).
2. **`/favicon.ico` and `/manifest.webmanifest` still 404** (§3) — deliberate.
3. **`/map` reached the Next.js error boundary at least once** during the gate's pass; not reproduced
   in any of this session's 30+ loads (`err=0` throughout). Unexplained, not dismissed.
4. The **8 carried-over rows** and the unfiltered-surface cost of `window_days=1` are unchanged from
   `docs/roadmap.md`.
5. This report's accessibility verdict is **axe-only**. axe finds what rules encode; it is not a
   substitute for a human screen-reader pass, and no such pass has been done.
6. **The CLS gate is 390/1280/1350 only.** §11 found a 0.317 breach at 640px that no gate cell
   was measuring, and only caught it because a new probe happened to run that width. Tablet
   widths should be added to `cls.js` rather than left to ad-hoc probes.

## 11. The takeover round — two nits closed, and a third CLS defect found while measuring them

**11.1 The two running subagents were taken over, not waited on.** The `design-qa` session was
reclaimed mid-run and returned a complete verdict; the general "Fix gate-found defects" session had
been dead for 11 hours, and its work had already landed inline in `de0f291`. design-qa's six
findings all held on re-measurement. Its **pin hit-area finding was REFUTED as a defect**: the leaves
measure **24.5 × 24.5 across 12/12** — the old 23 × 24 was the probe's own artefact, so no CSS change
was warranted. Three findings it raised on its own initiative were new: the freshness badge is
reachable at `score=Low` with a lowered floor (`/data?score=Low&min_dom=14&page=12` and
`/data?score=Low&min_dom=0&zip=10306`, 18 × 14 fully visible), **`srSilenced=0`** (7/7 chart summaries
carry real values and 16/16 SVGs sit inside `aria-hidden`), and the `"In filter 0"` flash lasts
**< 1.5 s** on `/trends` arrival rather than a persistent lie.

**11.2 Nit 1 — the header nav dropped the filter.** `/trends` promises *"Reflects the current map
filters"*, but the static header links were bare paths, so navigating by header silently reset the
cohort (43 → 133). Fixed with a new client component `site/components/FilterNav.tsx`, which builds the
three explorer hrefs from the current URL search params. Verified by `navfix.js` on **both** builds:
hrefs on `/data?score=High&min_dom=90` are `["/","/map?score=High&min_dom=90","/trends?score=High&min_dom=90","/data?score=High&min_dom=90"]`,
and clicking Trends lands on `IN FILTER: 43`, not 133.

**11.3 Nit 2 — `/trends` claimed "0 listings shown" while the first fetch was in flight.** A `loaded`
state now gates the KPI (`…` while loading) and the empty row alike.

**11.4 A regression this round's own fix introduced — caught before it shipped.** The `catch` branch
of that fix set `deals = []` with `loaded = true`, which turned a *failed* fetch into a false zero
claim: exactly the bug §11.3 fixed, reintroduced one branch over. A third state `loadError` was added,
mirroring `data/page.tsx`: KPIs render `!` / *"couldn't load"*, the row renders *"Couldn't load
listings — reload to try again."*, and a `describe()` wrapper makes the 7 `sr-only` chart summaries
say *"loading."* / *"couldn't load the listings."* instead of *"no data in the current filter."*
`trendstates.js` asserts all six states — `{"loadingShowsEllipsis":true,"loadingMakesNoZeroClaim":true,"loadedShowsRealCount":true,"errorDoesNotClaimZero":true,"errorSaysError":true,"errorSummarySaysError":true}` — locally and live.

**11.5 F6 — the intermittent `/data@390 = 0.1466` CLS breach, root-caused and fixed.**
The `Freshness` header strip changes width three times: **78 px** loading, **118 px** live, and up to
**~464 px** once the detail line and the frozen pill are both present. The header's first row at 390
leaves it **135 px** (390 − 211 px logo − 12 px gap), so when `/api/meta` fell back to the bundled
sample (`live:false`) the `frozen fallback` pill could not fit, the flex row wrapped onto a **third**
header line, and `<main>` moved down **28 px** → **0.1466 CLS**. This is not speculative: the bad run
was reproduced on the frozen path, and `header390.js` with `live:true` shows a stable `rows=3
headerH=69` header throughout.

Four parts, all in `site/components/Freshness.tsx` + `site/app/layout.tsx`:

1. Below `lg` the frozen state folds into **one pill carrying the date** (`Frozen · 2026-10-15`,
   114 px) instead of prefix + pill. The badge is *folded, not dropped* — `/map` renders neither
   `IngestionHealth` nor `HeroStats`, so hiding it on a phone would have removed the frozen signal
   entirely there.
2. The `Data as of {date}` prefix becomes `sr-only lg:not-sr-only` while frozen, so the pill never
   has to share the row with it.
3. The wrapper in `layout.tsx` is **`max-w-[130px] truncate` below `lg`** — the measured ceiling
   under the live width at every width below 1024 — making the box *structurally* unable to reflow
   the header, whatever string it is handed in future.
4. The detail line's threshold moved from `sm:inline` to `lg:inline` (§11.6).

**11.6 The same mechanism at tablet widths — 0.317, pre-existing, also fixed.**
While re-measuring §11.5, a probe at 640 and 768 px returned **0.31726 / 0.31675** — three times the
0.1 budget, in the **normal live path**. Attribution first: the **deployed pre-fix build scored
0.31728 at the same width**, so this was not introduced here, and it had never surfaced because the
CLS gate only measures 390/1280/1350. Mechanism (`rowgeo.js`, measured not guessed): from 640–830 the
logo (211) + nav (190) leave **~183 px**, but the detail line makes the box **374 px**, so it always
wrapped — `headerH` 41 → 69 on every load, `<main>` +28 px. The fix is the threshold move to `lg`:
**1024 is the first standard breakpoint above the band**, which is the same *"detail only where there
is room"* rule this span always had, with the breakpoint set by measurement instead of by assumption.
Result: `/data@640 = 0.00119`, `/data@768 = 0.00099`, and `rowgeo.js` now shows `rows=1 headerH=41
fresh=118` at 640/700/768/900.

**11.7 Disclosed behavior change.** Between **640 and 1023 px** the header no longer shows
*"· 1,011 tracked (sample) · 43 High · source zillow"*; it shows `Data as of <date>` only, as it
already did on phones. Those figures remain in the hero on `/` and in `IngestionHealth` on `/data`
and `/trends`. This is a deliberate trade: keeping the line visible at those widths is what caused
the 0.317 shift.

**11.8 Verification — local and production, identical.**

| check | local | production |
|---|---|---|
| CLS 12 cells, worst | 0.01889 | 0.01889 |
| axe 8 cells | 0 violations / 0 serious+critical | 0 violations / 0 serious+critical |
| frozen header height stable @390/640/768/1280 | 69=69, 41=41, 41=41, 41=41 | identical |
| `/data@390` **frozen** CLS | **0.00190** (was 0.1466) | 0.00190 |
| `/data@640` live CLS | **0.00119** (was 0.31728) | 0.00119 |
| `/data@768` live CLS | **0.00099** (was 0.31675) | 0.00099 |
| worst frozen CLS, any width | 0.00924 @1280 — `anyOverBudget: false` | identical |
| `navfix.js` | all true | all true |
| `trendstates.js` | 6/6 true | 6/6 true |

Reported honestly: the first `navfix.js` run after two heavy sweeps returned `navFilterHolds=false`
because the KPI was sampled while still showing `…`; a solo re-run and the production run both return
`true` with `IN FILTER: 43`. New probes for this round: `navfix.js`, `trendstates.js`,
`header390.js`, `frozencls.js`, `tabletcls.js`, `rowgeo.js`. Raw JSON under
`%TEMP%\opencode\gate\out\` (`frozencls.json`, `tabletcls.json`, `rowgeo.json`).

**11.9 Deploy.** `dpl_FuzAiwPgnQTjorvhaRPVWgw4839f`
(`off-market-radar-8trkq9hql-frappppy.vercel.app` → alias `https://off-market-radar-nyc.vercel.app`),
`vercel deploy --prod` from the repo root. Every number in §11.8's production column was measured
against that deployment. ~~Push-to-deploy remains unwired pending §9.7.~~ **Correction (2026-10-17):
push-to-deploy is wired now** — the App was installed and a push to `main` (`3495fea`) created
`dpl_9wcKJJhChPefgAfgKrXYa4Xwt478` (`source=git`, `target=production`) with no CLI command. See
§9.7, Correction.
