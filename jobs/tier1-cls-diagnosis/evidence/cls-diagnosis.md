# Tier-1 CLS diagnosis — off-market-radar-nyc.vercel.app @ f85a6e4

Read-only performance diagnosis. No repo file was edited, no commit, no branch, no
`vercel` command, no `next build`. Deployed source read with `git show f85a6e4:site/<path>`.
All experiments were in-browser (injected `<style>`, rewritten `/api/*` responses); no
forms were submitted and no writes were made.

**Method.** Chromium via Playwright, viewport set with CDP
`Emulation.setDeviceMetricsOverride` (`mobile:false`, `deviceScaleFactor:1`,
`Emulation.setTouchEmulationEnabled:false`) — `page.setViewportSize` silently left the
layout at the first combo's width and was discarded. Metrics collected by an init script
installed with `addInitScript` (runs before page script on every navigation):

- `PerformanceObserver({type:'layout-shift', buffered:true})` with fully resolved
  `entry.sources` (`previousRect`, `currentRect`, node path/text);
- real input listeners (`pointerdown/mousedown/touchstart/keydown/click/wheel`);
- `element-timing`-free rAF geometry sampler over `header`, `main`, `footer`,
  `main > div > *`, `.panel`;
- `MutationObserver` (childList + class/style);
- `document.fonts.ready`, FCP, LCP.

**`hadRecentInput` caveat.** Touch emulation was **disabled** for every reported run
because CDP touch emulation marks shifts `hadRecentInput` with no input event ever
recorded (a false "CLS 0"). Verified per run: **0 input events captured and 0 shift
entries with `hadRecentInput:true`** across all 12 baseline route×viewport cells and all
fix runs. `clsRaw == clsFiltered` in every reported run, so the numbers below are raw
unfiltered CLS and are directly comparable to Lighthouse/PageSpeed.

**Commit:** `f85a6e4`. **Measured:** 2026-10-16. Deployed API state during measurement:
`/api/health` → `live:true`, `snapshot_days:2`, `runs_ok_30d` present; `/api/meta` →
`live:true, total_tracked:1011, high_count:43, source:zillow`; `/api/zips` → 211 rows,
2 distinct `snapshot_date` values (`2026-10-15`, `2026-10-16`).

---

## 0. Instrumentation validation

The published QA table was reproduced before any experimentation:

| route | QA table | my `clsRaw` | match |
|---|---|---|---|
| `/trends` @1350×940 | 1.0253 | **1.02528** | exact |
| `/` @390×844 | 0.2409 | **0.24094** | exact |
| `/` @1280×900 | 0.1988 | **0.19880** | exact |
| `/trends` @1280×900 | 0.2722 | **0.27222** | exact |
| `/trends` @390×844 | 0.8027 | **0.80272** | exact |

`/trends` @1350 also matches the independent Lighthouse value (1.0253) to 4 decimals, and
my clean re-runs reproduced `0.27222` (baseline) and `0.09202` (fixed) byte-for-byte on
separate days/sessions — the measurements are deterministic, not noisy. **Run-to-run
variance exists** in *when* content lands (one `/trends` run delivered content at 381 ms,
another at 2788 ms), which moves the *magnitude* of the capped-distance shifts; the
mechanisms are stable.

## 1. Baseline CLS, per route × viewport (raw, unfiltered)

| route | 390×844 | 1280×900 | 1350×940 |
|---|---|---|---|
| `/` | 0.24094 | 0.19880 | 0.36207 |
| `/map` | **0.55922** | 0.02431 | 0.08555 |
| `/data` | **0.56039** | 0.04706 | 0.12501 |
| `/trends` | **0.80272** | 0.27222 | **1.02528** |

Only `/map`@1280 (0.02431), `/data`@1280 (0.04706) and `/`@390-1280 are anywhere near the
0.1 budget. **Every other cell fails**, and the 390 px phone viewport is the worst on all
four routes. The prior QA table listed only `/map`@1280 and `/data`@1280; at 390 both are
~0.56, i.e. 11× and 20× the budget.

## 2. The prerendered shell — the single upstream cause

Served HTML (`jobs/tier1-cls-diagnosis/raw/` sibling captures; `/tmp`-equivalent
`html/{root,map,data,trends}.html`) contains the Next.js client-side-rendering bailout on
**all four** routes:

```html
<main class="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
  <!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template>
  <p class="text-sm text-zinc-400">Loading trends.</p><!--/$--><!--$--><!--/$-->
</main>
```

Prerendered `<main>` payload:

| route | `main` chars | what the shell actually contains |
|---|---|---|
| `/` | 2755 | hero + KPI `<dl>` + `Loading explorer.` + insights `section.grid` |
| `/map` | 155 | `Loading map.` + empty Suspense slot |
| `/data` | 151 | `Loading data.` + empty Suspense slot |
| `/trends` | 153 | `Loading trends.` + empty Suspense slot |

All four routes contain exactly **1** `BAILOUT_TO_CLIENT_SIDE_RENDERING` marker, 0
`@font-face`, 0 `.woff` references. The bailout comes from
`site/lib/useFilters.ts` calling `useSearchParams()` inside the Suspense boundary that
wraps the page body, so every route's real content is inserted **only after hydration**.
`main` is `flex-1` (`site/app/layout.tsx`), so in the shell it stretches to fill the
viewport and the **footer lands inside the first screen at 390** (measured footer rect
`[0,379 375×465]`) — this is the 0.55808 shift described in §3.1.

> Copy observation (not CLS): the prerendered header status span reads
> `Loading data.` on **all four** routes, including `/map` and `/trends`, and `/map`,
> `/data`, `/trends` ship **0 `<h1>` in the shell** (only `/` has one). Both are
> pre-hydration artifacts, but they are what a no-JS / slow-JS client sees.

## 3. Per-route shift attribution

Full resolved-source dump: `raw/attribution.txt`. Values are the shift's own contribution;
`prev`/`cur` are viewport-relative `[x,y width×height]`.

### 3.1 `footer` shift = 0.55808 on `/map`, `/data`, `/trends` @390 (identical value)

```
/map   @390  t=1957  v=0.55808  prev=[0,379 375x465] cur=[0,0 0x0]  footer
/data  @390  t=1912  v=0.55808  prev=[0,379 375x465] cur=[0,0 0x0]  footer
/trends@390  t=2788  v=0.55808  prev=[0,379 375x465] cur=[0,0 0x0]  footer
```

**Classification: (b) node inserted above — whole-page content inserted after hydration.**
The 465 px-tall footer is on screen at 390 because `main` is `flex-1` in the shell. When
hydration inserts the real page, the footer leaves the viewport. The value is identical on
three routes because footer height, viewport and the capped-distance geometry are
identical — that is a fingerprint of the mechanism, not a coincidence.

### 3.2 `main`/`footer` swap = 0.16232–0.97025 on `/`, `/map`, `/data`, `/trends` @1280–1350

```
/       @1350 t=1442 v=0.32850  main prev=[35,41 1280x710] cur=[28,41 1280x899]; footer prev=[0,751 1335x189] cur=[0,0 0x0]
/trends @1350 t=280  v=0.97025  main prev=[35,41 1280x710] cur=[28,41 1280x899]; footer prev=[0,751 1335x189] cur=[0,0 0x0]
/       @1280 t=330  v=0.16232  footer prev=[0,711 1265x189] cur=[0,0 0x0]; section.grid prev=[16,553 1248x142] cur=[0,0 0x0]
```

**Classification: (b) node inserted above.** Same mechanism as §3.1 at desktop. The
`/trends`@1350 0.97025 is the largest single shift in the whole audit: the document grows
from 710 px of `main` to 899 px and the 189 px footer is displaced off a 940 px viewport,
so the distance fraction is capped near 1.0 and the impact fraction is ~1.0.

### 3.3 `/` — hero KPI `<dl>` pushed by a conditionally-rendered paragraph

```
/ @390  t=1062 v=0.15134  dl.mt-6.grid.  prev=[41,380 293x253] cur=[41,468 293x253]   (+88 px, height unchanged 253)
                          h1 TEXT        prev=[41,126 293x40]  cur=[41,157 293x40]    (+31 px, height unchanged 40)
                          div.mt-4.flex  prev=[41,318 293x38]  cur=[41,406 293x38]    (+88 px, height unchanged 38)
/ @1280 t=985  v=0.03458  div.space-y-3  prev=[16,517 1233x383] cur=[16,573 1233x327]
                          dl.mt-6.grid.  prev=[49,353 1167x115] cur=[49,409 1167x115]
```

**Classification: (a) a node grows above — `HeroStats.tsx` inserts a paragraph after
`/api/meta` resolves.** In `site/components/HeroStats.tsx` the scope line is conditional:
`{scope && <p className="mt-2 …">Sample scope: …}</p>}`. `scope` comes from `/api/meta`, so
before that fetch the paragraph does not exist. Probe of the hero panel:

| state | hero `section.panel` | ctas row | KPI `dl` | KPI cells |
|---|---|---|---|---|
| `scope = null` (pre-meta) | `[310, 80]` | y 318 | y 380, h 253 | 125 / 113 |
| `scope` set (post-meta) | — | y 406 (+88) | y 468 (+88), h 253 | 125 / 113 |

The KPI `dl` height (253) and every cell height (125/113) are **constant in every state**.

### 3.4 `Explorer` Suspense fallback → real explorer = +452 / +500 px, all routes

`Explorer` is wrapped in `<Suspense fallback={<p className="text-sm text-zinc-400">Loading
explorer…</p>}>` (20 px) and replaced by the real explorer — **520 px @390, 472 px @≥640**.
On `/` alone this moves `main` by +452/+500 px; on the other routes it is subsumed by the
whole-page insertion of §3.1/3.2.

### 3.5 `/trends` — the data-gated copy branch (mechanism 4)

Statements in the `<h1>` block are gated on data that has not arrived:
`snapshotCount` is 0 before `/api/zips` resolves, so the long branch
*"There is one snapshot date in this view so far…"* renders, then the real 2-date data
replaces it with the short branch:

```
/trends @1280 t=862  v=0.05839  div.grid.gap-3.md:grid-cols-2  prev=[16,490 1233x410] cur=[16,448 1233x452]
                                section.panel.p-3             prev=[16,318 1233x156] cur=[16,276 1233x156]
                                dl.grid.grid-cols-2.gap-px     prev=[16,192 1233x111] cur=[16,150 1233x111]
                                p.mt-1 TEXT                    prev=[16,114 1138x19]  cur=[16,114 624x19]
/trends @390  t=5099 v=0.24464  section.panel.p-3  prev=[16,512 343x333] cur=[16,472 343x357]
                                dl.grid.grid-cols-2 prev=[16,276 343x220] cur=[16,236 343x220]
                                p.mt-1 TEXT        prev=[16,158 343x39]  cur=[16,138 343x39]
```

**Classification: (a) node shrinking above.** The h1 column's intrinsic width collapses
1138 → 624 px when the text shortens, which un-wraps the `ShareLink` control, so the whole
heading row loses **42 px** and everything below (KPI `dl`, health card, both charts) moves
up by 42 px. Directly measured at 1280, with the reserve CSS applied, in
`raw/trends-residual.txt`:

```
       h1row         h1col        h1p(text copy)     share
t=524  [[57,179,1233]] [[57,137,1138]] [[114,80,1138]] [[206,30,112,"Copy link"]]   long branch
t=897  [[57,179,1233]] [[57,137,1138]] [[114,80,1138]] [[206,30,112,"Copy link"]]   long branch
t=941  [[57,137,1233]] [[57,137,624]]  [[114,80,624]]  [[57,30,112,"Copy link"]]    short branch  → row -42 px
```
and the same toggle in the unfixed baseline run (h1row `119 → 77`, same `-42 px`). **The
`p` itself never changes height** (`min-height:80px` held it at 80 px in both states) — the
residual is the flex-wrap line toggle, not the paragraph.

### 3.6 `/data` — table container `min-h-[400px]` → `max-h-[calc(100svh-260px)]`

```
/data @1350 t=1646 v=0.02877  div.panel.overflow-hidden > div.flex.items-center.gap-2  prev=[337,738 954x43] cur=[0,0 0x0]
                              footer prev=[0,883 1335x57] cur=[0,0 0x0]
/data @1280 t=920  v=0.01632  same panel header row prev=[309,738 939x43] cur=[0,0 0x0]
                              table th prev=[646,338 111x36] cur=[796,338 107x37]
```

**Classification: (a) node growing above / (a′) node removed and re-created.** The scroll
container starts at `min-h-[400px]` and grows to `max-h-[calc(100svh-260px)]` when rows
arrive (panel 445 → 725 px @1350), plus the skeleton header row is replaced. The footer
moves 195 px. The table `th` widths also change by 1 px (`36→37` height) as the row count
changes scrollbar state — a second-order contributor.

### 3.7 Header status line — small but present on every route

```
all routes  t≈600-800  v=0.00043 (390)  v=0.00160-0.00185 (1280/1350)
  div.order-2.ml-auto.min-w-0  prev=[1213,8 79x24] cur=[917,8 375x24]
```
The header starts with `Loading data.` (79 px wide) and becomes
`Data as of 2026-10-16 · 1,011 tracked (sample) · 43 High · source zillow` (375 px). Because
it is right-aligned in a flex row, its **left edge** moves 296 px — that is the recorded
shift. Height is constant at 24 px. **Classification: (a) node growing, horizontal only.**
Contributes ≤0.0019 per route; listed for completeness, not worth a dedicated fix.

### 3.8 `/map` — MapLibre attribution control

```
/map @1280 t=2544 v=0.00241  div.maplibregl-ctrl-bottom-right  prev=[1142,763 106x44] cur=[909,763 339x44]
/map @1350 t=504  v=0.00208  div.maplibregl-ctrl-bottom-right  prev=[1184,803 106x44] cur=[951,803 339x44]
```
**Classification: (a) node growing.** The attribution/scale control gains content once the
style loads; height constant 44 px, width 106 → 339 px. 0.002 level.

## 4. The three questions

### Q1 — Is the footer merely a victim?

**Yes, entirely.** In every route and viewport the footer's own height is either constant
or changing as a consequence of the document growing above it:
- at 390 its recorded source rect is `prev=[0,379 375×465] cur=[0,0 0×0]` — height 0 means
  the node was removed and re-inserted in the same frame, not resized;
- at 1280/1350 `prev=[0,751 1335×189] cur=[0,864 1335×77]` on `/map` — the footer genuinely
  *shrinks* (189 → 77 px) but that is a *result* of the page becoming tall enough that
  `main` no longer leaves room for the tall footer layout;
- it moves 195 px on `/data` because the table panel above it grew.
The footer has no JS, no async data and no self-driving height. Fixing anything in
`site/components/SiteFooter.tsx` would change nothing.

### Q2 — What is unstable in the hero KPI `<dl>`/grid?

**Nothing intrinsic. It is a pure victim and has no reserved-height problem.** The `dl`
is 253 px tall and its cells are 125/113 px in *every* state probed (`scope = null` and
`scope` set, both viewports). It is displaced by exactly the amount the sibling
*"Sample scope"* paragraph adds above it:
- `scope = null`: hero panel `[310, 80]`, ctas y=318, `dl` y=380
- `scope` set: ctas y=406 (**+88**), `dl` y=468 (**+88**)

There is no column-count change (the `md:grid-cols-3` breakpoint is crossed only by
viewport width, not by data) and no content-driven cell growth. On `/` @1280 the three
KPI cells also shift by 3 px horizontally (`294→291`, `279→291`) because the arrival of
content adds a vertical scrollbar — a second-order effect of §3.2, not of the `dl`. The
real defect is one line of `HeroStats.tsx`: conditional rendering of a paragraph that
arrives with async data.

### Q3 — Is `/trends`' health-card shift inherent or pushed from above?

**Both, and they must be fixed separately — it is not merely pushed.**

1. **Pushed from above (position).** During the §3.5 shift the card's `y` moves
   `512 → 472` and the KPI `dl` above it moves `276 → 236` — the same **−40 px** at 390 and
   **−42 px** at desktop. That part is the copy-branch collapse, i.e. purely inherited.
2. **Inherent (its own height).** Measured in isolation with all routes cleared
   (`raw/health-card.txt`, real sampler, `clsFixPresent:false` verified):

   | `live` | 390×844 | header row | card `dl` | badge |
   |---|---|---|---|---|
   | `true` (loading → settled) | **333 → 357 px** | 17 | 244 | 0 |
   | `false` (frozen fallback) | **357 → 377 px** | **17 → 37** | 244 | **1** |

   At **390** the card changes its own height twice: **+24 px** when `/api/health` resolves
   (loading state 333 px → settled 357 px — this reproduces the QA table's `333 → 357`
   exactly) and **+20 px** more when the payload reports `live === false`, because
   `IngestionHealth.tsx` then inserts *two* extra nodes into its header row (the
   `frozen fallback` badge and the sentence *"Numbers below are from the bundled sample, not
   a live run."*), which wraps the `flex flex-wrap` header row to a second line.
   At **≥640** the card is **156 px with a 17 px header row in both modes** — the `hidden
   sm:inline` badge plus the wider viewport keep it on one line, so the `live === false`
   growth is a **phone-only** defect.
3. The component's own comment claims *"Fixed shape … so the card does not reflow the page
   when it loads late"* and *"a fixed height so the card cannot reflow the page when it
   lands"*. The measurements show that intent is **not achieved at 390**: the card reflows
   by +24 px on data arrival and +20 px more in fallback mode.

   *Partial result:* I resolved the +20 px step completely (header row 17 → 37 px, one
   badge node). I did **not** fully decompose the +24 px loading→settled step to a named
   child; the card's `dl` measured 244 px once settled, and the step is confined to the
   card's own content (no ancestor moved in that frame). Treat the +24 px as measured but
   not decomposed.

## 5. Other findings

### 5.1 What re-renders the `/map` markers ~every 1.5 s

`site/components/DealMap.tsx:95`:

```js
const t = setInterval(render, 1500); // re-render when deals prop changes
```

Unconditional. `render()` clears `markersRef.current` and rebuilds every marker **and a
fresh Supercluster index** every 1.5 s while completely idle. It also detaches the marker
nodes a click may be targeting. **It causes no CLS on `/map`**: markers are absolutely
positioned inside the map container, and the `/map` shifts in §3.8 are the MapLibre
attribution control, not the markers. Fix it for CPU/interaction reasons, not for CLS —
`useEffect(..., [deals])` on the `deals` prop is the direct replacement.

These are the **only two timers** in the deployed site: this one and the 2 s
copied-state `setTimeout` in `ShareLink.tsx`.

### 5.2 Webfont-swap hypothesis (classification "(c)") — refuted

- 0 `@font-face` and 0 `.woff`/`.woff2` references in the served HTML of all four routes
  and in **both** deployed CSS bundles (`718ee59ff2172a97.css` 65 534 B,
  `9e434dec558e4fb1.css` 23 380 B); the declared stacks are system-UI/sans-serif.
- Every CLS entry starts **long after** `document.fonts.ready` (76–332 ms).
- Blocking all font requests in a dedicated run changed nothing.

**No shift in this audit is attributable to a webfont swap.** Any fix aimed at
`font-display` / preloading is wasted effort.

## 6. Fix validation (in-browser, no repo edits)

Fixes were applied by intercepting the document response with `page.route` and injecting a
`<style id="cls-fix">` before `</head>`, and by rewriting `/api/*` JSON via `route.fetch()`
→ `route.fulfill()`. Fresh-context runs; `#cls-fix` presence asserted.

| route | viewport | baseline | with fix | Δ | status |
|---|---|---|---|---|---|
| `/` | 390×844 | 0.24094 | **0.02067** | −92 % | PASS |
| `/` | 1280×900 | 0.19880 | **0.00504** | −97 % | PASS |
| `/` | 1350×940 | 0.36207 | **0.00466** | −99 % | PASS |
| `/trends` | 390×844 | 0.80272 | **0.02151** | −97 % | PASS |
| `/trends` | 1280×900 | 0.27222 | 0.09202 | −66 % | PASS (marginal) |
| `/trends` | 1350×940 | 1.02528 | 0.08445 | −92 % | PASS (marginal) |
| `/map` | 390×844 | 0.55922 | **0.00155** | −99.7 % | PASS |
| `/map` | 1280×900 | 0.02431 | **0.00612** | −75 % | PASS |
| `/map` | 1350×940 | 0.08555 | **0.00528** | −94 % | PASS |
| `/data` | 390×844 | 0.56039 | **0.00231** | −99.6 % | PASS |
| `/data` | 1280×900 | 0.04706 | **0.00621** | −87 % | PASS |
| `/data` | 1350×940 | 0.12501 | **0.00546** | −96 % | PASS |

Reservation CSS that produced these numbers (`/map` and `/data` rows measured in a clean
context with `unrouteAll` first; an earlier `fixall.js` version was contaminated by a
leftover `/trends` route and is superseded):

```css
/* / */
@media (max-width:639px){ main > div > p.text-sm{ min-height:520px } }
@media (min-width:640px){ main > div > p.text-sm{ min-height:472px } }
/* /trends */
@media (max-width:639px){ main > p.text-sm{ min-height:4260px } }
@media (min-width:640px){ main > p.text-sm{ min-height:2295px } }
/* /map */
@media (max-width:1023px){ main > p.text-sm{ min-height:calc(100svh + 417px) } }
@media (min-width:1024px){ main > p.text-sm{ min-height:calc(100svh - 149px) } }
/* /data */
@media (max-width:639px){ main > p.text-sm{ min-height:calc(100svh + 921px) } }
@media (min-width:640px){ main > p.text-sm{ min-height:calc(100svh + 65px) } }
```

**The two marginal rows are honest.** `/trends` @1280/@1350 land at 0.092/0.084 — under
budget but with almost no headroom, and the residual is fully attributed in §3.5: the
flex-wrap line toggle in the heading row. **The reservation CSS alone does not fix it**
(`min-height` on the paragraph does nothing, because the paragraph's height never changed).
It needs the heading row itself reserved (see F3 below).

## 7. Ranked minimal fix plan

Ordered by CLS removed per unit of change. F1 is worth ~0.56–1.03 on its own at 390.

### F1 — Stop the CSR bailout on the three data routes (~0.56 @390, up to 0.97 @1350)

`site/lib/useFilters.ts` — drop `useSearchParams()` (read `window.location.search` in a
`useEffect`, or lift the filter state into a client provider that does not opt the page out
of static rendering). If that is not feasible yet, server-render a real shell for
`/map`, `/data`, `/trends` and keep them dynamic:
`export const dynamic = 'force-dynamic'` in `site/app/{map,data,trends}/page.tsx`.
Removes the `BAILOUT_TO_CLIENT_SIDE_RENDERING` marker so the footer is never inside the
first viewport of a page that is about to grow.
*Expected*: the §3.1 (0.55808) and §3.2 (up to 0.97) shifts stop existing.
*Verify*: `curl -s https://…/map | grep -c BAILOUT` → 0; re-measure all 12 cells (target
`/map`@390 < 0.02).

### F2 — Make the hero scope paragraph unconditional (~0.15 @390, ~0.035 @1280)

`site/components/HeroStats.tsx` — the `{scope && <p className="mt-2 …">Sample scope: …</p>}`
block. Either render the paragraph unconditionally (with a placeholder/`skeleton` of the
same height until `scope` arrives) or render it server-side so it is in the shell.
*Expected*: 0.24094 → ~0.02 @390, 0.19880 → ~0.005 @1280 (measured, see §6).
*Verify*: hero `dl` y stays 398 at 390 / 409 at 1280 across `scope=null` and `scope` set.

### F3 — Fix the data-gated copy in the `/trends` heading row (~0.09 desktop residual)

`site/app/trends/page.tsx` — the `snapshotCount`-gated sentence (long branch
*"There is one snapshot date in this view so far…"* vs short branch). Two changes, both
needed:
1. **Server-render the copy** (or compute `snapshotCount` before hydration) so the long
   *wrong* branch is never painted. This is a **correctness** fix as well: the loading
   branch currently asserts "one snapshot date" when the API has two.
2. **Reserve the heading row** so a copy change cannot re-wrap `ShareLink`:
   `min-h-[179px] sm:min-h-[137px]` on the `div.flex.flex-wrap.items-start` wrapper, or
   `flex-none` + `whitespace-nowrap` on the `ShareLink` (`site/components/ShareLink.tsx`)
   so it can never take its own flex line.
*Expected*: `/trends` @1280 0.09202 → ~0.002; @1350 0.08445 → ~0.002.
*Verify*: `h1row` height constant across both copy branches at 1280 (currently 179 → 137).

### F4 — Reserve the `/data` table container (~0.028 @1350, ~0.016 @1280)

`site/app/data/page.tsx` — the scroll container's `min-h-[400px]` grows to
`max-h-[calc(100svh-260px)]`. Set `min-height` to the same `calc(100svh-260px)` (or render
a same-height skeleton inside the `panel`) so the panel is born at its final height.
*Expected*: `/data` @1350 0.12501 → ~0.005 (measured with this rule: `min-h … calc(100svh-260px)`).

### F5 — Make the health card's height data-independent at 390 (+24 px, +20 px)

`site/components/IngestionHealth.tsx`. The card measures 333 px (pre-`/api/health`),
357 px (settled, `live:true`) and 377 px (`live:false`) at 390 — three different heights
for one card whose comment promises a fixed shape. Either:
- reserve it: `min-h-[377px] sm:min-h-[156px]` on the `<section className="panel p-3">`; or
- stop the header row wrapping: keep the `frozen fallback` badge and the
  *"Numbers below are from the bundled sample…"* sentence out of the wrapping
  `div.flex.flex-wrap` (make the sentence `truncate`/`hidden sm:block`, or give the row a
  fixed two-line reservation).
*Expected*: removes the `/trends`@390 second shift (0.24464) and the card's own +20 px.
*Verify*: card height identical at 390 in loading, `live:true` and `live:false`.

### F6 — Replace the 1.5 s marker rebuild (~0 CLS, but CPU + broken clicks)

`site/components/DealMap.tsx:95` — `setInterval(render, 1500)` → `useEffect(() => render(),
[deals])`, and keep `markersRef` cleanup. No CLS benefit (markers are absolutely
positioned); do it for the 40 rebuilds/minute of clusters + markers while idle and for
click targets that survive a re-render.

### Explicitly not worth doing

- **Any font fix** (§5.2 — refuted).
- **The header status line** (§3.7, ≤0.0019/route) — the shift is horizontal only and the
  string is genuinely data-dependent.
- **The MapLibre attribution control** (§3.8, ~0.002) — third-party control layout.
- **Touching the footer** (§4/Q1 — it is never the cause).

## 8. Undetermined / partial

1. **The health card's +24 px loading→settled step** at 390 is measured (333 → 357) but not
   decomposed to a named child. Its `dl` is 244 px once settled; no ancestor moved in that
   frame. Consequence for the fix plan: reserve the card (§F5) rather than patch a specific
   child.
2. **The `/` @1280 3 px horizontal shift of the three KPI cells** (`294→291`, `279→291`)
   is consistent with the arrival of a vertical scrollbar but was not verified by toggling
   `overflow-y` directly.
3. **Timing variance.** Content arrival times differed by ~7× between runs (381 ms vs
   2788 ms on `/trends`), which changes the *magnitude* of capped-distance shifts. All
   mechanisms reproduced in every run; the table in §1 is one representative session.
   Re-running may move values by several hundredths.
4. **`/map`'s and `/data`'s 1350 baselines** (0.08555, 0.12501) were measured in one
   session only; their 1280 values were independently reproduced.
5. **A leftover `page.route` registration from an earlier run silently applied a
   `/trends` CSS fix to a later config** in the first `fixall.js` run (detected because
   `#cls-fix` was present where no CSS should have been injected). All `/map` and `/data`
   numbers in §6 come from the corrected run with `unrouteAll()` first. Recorded because it
   is the kind of contamination that silently invalidates a measurement.

## 9. Evidence index

| path | contents |
|---|---|
| `raw/attribution.txt` | every shift, resolved sources, prev/cur rects, node paths — the basis of §3 |
| `raw/cls-{root,map,data,trends}.json` | baseline per-viewport payloads (all 3 viewports each) |
| `raw/console-{root,map,data,trends}.log` | raw instrumented console streams |
| `raw/fix-trends2.json` | corrected `/trends` fix payload (the earlier `fix-trends.json` was reassembled with the wrong tag filter) |
| `raw/console-fix-root.log`, `raw/console-fix-trends.log` | `/` and `/trends` fix runs |
| `raw/health-card.txt` | clean-context health-card sampler (live vs `live:false`, 390 and 1280) |
| `raw/trends-residual.txt` | `/trends` heading-row flex-wrap toggle, fixed vs unfixed |
| `scripts/` | `cls-init.js` (instrumentation), `fix.js`, `fixall.js`, `fixmd.js`, `health.js`, `trendsres.js`, `trendsres2.js`, `extractfix.ps1`, `dump.ps1` |
| `/tmp`-equivalent `html/*.html`, `html/*.css` | served shell HTML + both deployed CSS bundles (bailout/font evidence) |
