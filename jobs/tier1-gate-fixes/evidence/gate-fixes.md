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
| Repo HEAD | `f85a6e4` (the gate-fix work is uncommitted at the time of writing) |
| Deployed | `dpl_2RjajPjG5rtqENnnzjQEDPEwzjWe` → `off-market-radar-f1wxct749`, aliased to `https://off-market-radar-nyc.vercel.app` |
| Local target | `next build` + `next start -p 3222` from `site/` |
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

## 9. Residuals — not fixed, stated

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
