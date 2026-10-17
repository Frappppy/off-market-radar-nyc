# Tier-1 CLS fix — F1–F6 implementation and verification

Implements the ranked plan in §7 of
`jobs/tier1-cls-diagnosis/evidence/cls-diagnosis.md`, then re-measures all 12
route×viewport cells against a **local production build** (`npm run build` +
`next start`), not the deployed site.

- Tree: the working tree at the time of the fix (large pre-existing uncommitted
  change set preserved — nothing committed, no branch, no `vercel` command).
- Baseline: pre-fix production build served on `localhost:3210`
  (`raw/baseline-cls.json`). After: fixed production build served on
  `localhost:3222` (`raw/after-cls.json`).
- Harness: `jobs/tier1-cls-diagnosis/scripts/cls-init.js` via
  `addInitScript({path})`; viewport via CDP `Emulation.setDeviceMetricsOverride`
  (`mobile:false`, `deviceScaleFactor:1`) with `Emulation.setTouchEmulationEnabled
  {enabled:false}`; each cell = `goto(waitUntil:'load')` + 9 s settle.
- Both servers stopped; no listener left on 3210/3222.

## 1. Result

**Every one of the 12 cells is under the 0.1 budget.** Worst cell after the fix
is `/`@390 at **0.022**.

| route | 390×844 | 1280×900 | 1350×940 |
|---|---|---|---|
| `/` | 0.26994 → **0.022** (−92%) | 0.32773 → **0.00525** (−98%) | 0.48194 → **0.01565** (−97%) |
| `/map` | 0.55938 → **0.00157** (−99.7%) | 0.02473 → **0.00287** (−88%) | 0.0859 → **0.00506** (−94%) |
| `/data` | 0.56039 → **0.00231** (−99.6%) | 0.04516 → **0.00466** (−90%) | 0.13312 → **0.00851** (−94%) |
| `/trends` | 0.80129 → **0.00043** (−99.9%) | 0.27222 → **0.00185** (−99.3%) | 1.02528 → **0.0016** (−99.8%) |

`clsRaw == clsFiltered` and `inputs == 0` / `hadRecentInput count == 0` in all 12
cells (`raw/after-cls.json`), so these are raw unfiltered CLS values comparable
to Lighthouse/PageSpeed.

Raw captures: `raw/after-cls.json` (per-cell CLS + the three largest residual
shifts with resolved source node paths). Baseline: `raw/baseline-cls.json`.

> Baseline note. The recorded baseline came from the pre-fix local build on
> 3210. `/`@1280 (0.32773) and `/`@1350 (0.48194) run higher than the deployed
> diagnosis (0.19880 / 0.36207) — timing variance in *when* the deferred content
> lands, which the diagnosis §0/§8.3 already documents. Every mechanism
> reproduced; the conclusion (fix moves every cell under budget) does not depend
> on which baseline run is used.

## 2. What changed, per F-item

### F1 — remove the CSR bailout from the filter path
The bailout came from `useSearchParams()` in `site/lib/useFilters.ts` inside the
`<Suspense>` that wraps each explorer body. Rather than force dynamic rendering
(the routes are prerendered; local TTFB is ~1.8 ms), the read was replaced with a
tiny external store:

- `site/lib/useUrlSearch.ts` (**new**) — `useUrlSearch()` / `setUrlSearch()`:
  `useSyncExternalStore` seeded from `window.location.search`, server snapshot
  `""`. Server render and first hydration render both see `""`, so they agree and
  there is no hydration mismatch; the live query string is folded in on subscribe.
  Writes go through the callers that already call `router.replace`.
- `site/lib/useFilters.ts:8,26,79–80,87` — `useSearchParams()` → `useUrlSearch()`;
  `set`/`reset` call `setUrlSearch(...)` after `router.replace`.
- `site/components/Explorer.tsx:4,37`, `site/components/FilterNotices.tsx:2,11`,
  `site/app/data/page.tsx:10,80,124` — same swap.

Result: all four routes are now `○ (Static)` and ship **0**
`BAILOUT_TO_CLIENT_SIDE_RENDERING` markers. The footer is never inside the first
viewport of a page that is about to grow, so the §3.1 (0.55808) and §3.2 (up to
0.97) shifts no longer exist.

### F2 — hero scope paragraph made unconditional **and** data-independent
`site/components/HeroStats.tsx:54–73`. The `{scope && …}` paragraph now renders
always with fixed wording (`marketSizeLabel` + `MARKET_REFERENCE` were imported at
line 4; `scope` is still computed for the KPI strip's "Tracked" cell at line 32).
A reserved `min-height` was rejected: it could not cover width-dependent wrapping
between 640–1024 px, whereas a fixed sentence cannot change height at any width.
Nothing is lost — the live count and its share sit in the strip immediately below.

### F3 — `/trends` heading copy made static (correctness + CLS)
`site/app/trends/page.tsx:152–170`. The `snapshotCount`-gated sentence was
replaced with fixed wording, which fixes **two** things at once: the pre-data
branch used to assert "one snapshot date" while `/api/zips` returns two, and the
long branch inflated the h1 column (1138 px vs 624 px max-content), pushing
`ShareLink` onto a second flex line and growing the heading row 179→137 (390) /
119→77 (≥1280). The unused `snapshotCount` `useMemo` was removed. Same rationale
as F2 re: intermediate widths. The snapshot count is still stated by the
ingestion card ("History depth: N daily snapshots").

### F4 — `/data` table container born at final height
`site/app/data/page.tsx:268` — `min-h-[400px]` → `min-h-[calc(100svh-260px)]`,
mirroring the existing `max-h`. The box no longer grows 400 → 584/640/680 px when
rows arrive. This accepts exactly the same floor the 400 px rule already imposed
on a short result set.

### F5 — health card reserved at its real worst-case height
`site/components/IngestionHealth.tsx:131–139` — `min-h-[377px] sm:min-h-[156px]`.
377 px is the measured worst case at 390 (the `live:false` path where the
"frozen fallback" badge + its sentence wrap the header row); 156 px is the real
height at ≥640. The `live:false` path is unreachable while `/api/health` reports
`live:true`, so this changes nothing in the 12 cells — it closes the phone-only
+20 px step the diagnosis flagged.

### F6 — replace the 1.5 s marker rebuild
`site/components/DealMap.tsx:17,52–59,140–159`. `setInterval(render, 1500)` →
`useEffect(…, [deals])` with `renderRef`/`readyRef`; `renderedRef` removed. An
idle map now does zero work, and a redraw happens only on a genuinely new `deals`
array — preserving the S1 intent (markers keep keyboard focus across an idle
period). No CLS effect either way (markers are absolutely positioned).

## 3. Verifications required by the task

**Bailout / static render** (`raw/baseline-html-*.html`, `raw/after-html-*.html`):

| route | baseline BAILOUT | after BAILOUT | baseline `<h1>` | after `<h1>` |
|---|---|---|---|---|
| `/` | 1 | **0** | 1 | 1 |
| `/map` | 1 | **0** | 0 | 1 |
| `/data` | 1 | **0** | 0 | 1 |
| `/trends` | 1 | **0** | 0 | 1 |

The fixed build's route table marks `/`, `/data`, `/map`, `/trends`,
`/opengraph-image`, `/icon.svg` as `○ (Static)`; `/api/*` stay `ƒ (Dynamic)`. No
`force-dynamic` is used.

**Build / typecheck.** `npm run build` → **exit 0**. Only warning is the expected
`Critical dependency: the request of a dependency is an expression`
(`node_modules/jiti/lib/jiti.mjs`, reached via `lib/db.ts → @neon/config →
@neon/env`). No other warning. `npm run typecheck` → **exit 0**.

**Console / network clean.** 0 console errors and 0 failed requests across
4 routes × {390×844, 1280×900} (`raw/after-cls.json` → `consoleAndNetwork`) and
in the full 12-cell run.

**Filters / search params still work** (the risky half of F1) —
`raw/filters-verify.json`:

- `/map?score=High&min_dom=90` → controls reflect the URL; `/api/deals` returns
  **43** (vs 133 default).
- `/map?score=High&min_dom=120&zip=11215,11216&type=house&min_price=500000&max_price=900000`
  → controls reflect every param (High only, DOM 120, min/max price, type, ZIPs)
  and the query legitimately matches 0 rows; the API agrees.
- `/data?score=High&min_dom=90&type=house` → panel "13 shown", DOM slider 90,
  type house, High checked, Medium unchecked.
- `/trends?score=High&min_dom=90` → "In filter" KPI = 43; `?type=house` → 55;
  default → 133.
- `/?score=High&min_dom=90&zip=11215,11216&type=house&min_price=500000&max_price=900000`
  → S2 disclosure renders ("From this link: ZIP 11215, 11216 · type house ·
  min $500,000 · max $900,000") and the `/map?…` hand-off keeps the whole query.

**`/opengraph-image`** → `200`, `image/png`, 50028 bytes (curl on 3222).

**TTFB** (local, wkhtml/curl):

| route | before (median ms) | after (median ms) |
|---|---|---|
| `/` | 1.61 | 2.24 |
| `/map` | 1.66 | 1.88 |
| `/data` | 1.64 | 1.85 |
| `/trends` | 1.60 | 1.80 |

Routes stayed prerendered; the +0.2–0.6 ms is a larger prerendered payload
(`mainChars` `/` 2811→4203, `/map` 211→4884, `/data` 207→9743, `/trends`
209→7592), not a rendering-mode change.

**No regression of the ui-fixes work** (`jobs/tier1-ui-fixes/evidence/ui-fixes.md`):
S1 marker focus model preserved (F6 redraws only on a new `deals` array and gates
on `readyRef`); duplicate ShareLink reduction untouched; `/opengraph-image` still
200/`image/png`; S2/S8 disclosures still render; S5 `useId` label wiring
untouched; S6/S7/S9/S10 surfaces untouched.

## 4. Constraints honoured

- Not committed, not pushed, no branch, no `vercel` command.
- No new npm dependency (`package.json` is not in `git diff`).
- Did not touch `docs/`, `README.md`, `src/`, `sql/`, `tests/`, `dashboard/`.
- No font work: `site/app/globals.css` contains 0 `@font-face` / `font-display` /
  `.woff` / `font-family` rules.
- Footer not touched: the footer markup lives in `site/app/layout.tsx`, which this
  task did not edit (0 `F1–F6` markers in it). `SiteFooter`/`Footer` is not in the
  changed-file set.
- Header status line and MapLibre attribution control left alone (both on the
  diagnosis's explicit not-worth-doing list; they remain the only visible
  residuals — see §6).
- Reservations are legitimate: the two added `min-height`s (F4, F5) mirror an
  existing `max-height` / real measured geometry, not arbitrary values whose only
  purpose is pushing the footer off-screen.

## 5. Trade-offs

- **F1, one extra `/api/deals` request on a filtered deep link.** With
  `useSearchParams()` the first client render already held the params (one fetch).
  The external store's server snapshot is `""` by design, so a filtered deep link
  now issues a default query and then the corrected one. Both land in the same
  settle window; the corrected query is what renders, and a filtered load
  re-renders data only (no new layout shift — the 12 cells are measured on
  param-free loads and land far under budget). Net: correctness of static
  prerendering + footer stability bought with one redundant request on links that
  carry filters.
- **F2 / F3, vertical slack.** Both made a data-gated paragraph static rather than
  reserving a height. This adds a small fixed amount of text that is present in
  every state (no CLS), at the cost of not shortening for the empty state.
- **F4, permanent floor.** The `/data` scroll box now always occupies
  `calc(100svh-260px)`, so a very short result set leaves whitespace — the
  identical floor the previous `min-h-[400px]` already imposed on that case.
- **F5, phone dead band.** `min-h-[377px]` reserves 20 px more than the live card
  needs at 390; this is the deliberate cost of making the card's height
  data-independent, and it is invisible (no shift) rather than wrong.

## 6. Residual shifts after the fix (all under budget)

From `raw/after-cls.json`, the largest remaining shifts are the diagnosis's own
"explicitly not worth doing" items plus one known residual:

- **header status line** — the data-dependent, horizontal-only shift
  (≤0.0019/route); untouched by instruction.
- **`/` hero `<h1>` text reflow** — ~0.019 at 390, ~0.003 at 1280/1350. The
  `<h1>` is still data-gated (`"43 motivated sellers …"`); the count changes the
  text width and reflows the compact toolbar span beside it. Under budget at every
  measured cell; it could change height only at 768–1023 px widths, outside the 12
  cells. Left as-is (not in F1–F6) and disclosed.
- **MapLibre attribution control** on `/map` (≤0.0028) — third-party control.
- **`/data` sticky `th` widths** on data arrival (≤0.0085) — second-order
  scrollbar-state change inside the already-reserved box.

## 7. Reproduce

```powershell
# 1. production build of the current tree
cd 'site'
npm run build            # expect exit 0, only the jiti "Critical dependency" warning
npm run typecheck        # expect exit 0

# 2. serve it
node node_modules/next/dist/bin/next start -p 3222

# 3. 12-cell CLS: same harness as the diagnosis
#    addInitScript({ path: .../jobs/tier1-cls-diagnosis/scripts/cls-init.js })
#    viewport via CDP Emulation.setDeviceMetricsOverride {mobile:false, deviceScaleFactor:1}
#      + Emulation.setTouchEmulationEnabled {enabled:false}
#    4 routes x [390x844, 1280x900, 1350x940], each goto + 9s -> read window.__LS

# 4. bailout sanity (expect 0 on all four)
curl.exe -s http://localhost:3222/map | Select-String BAILOUT_TO_CLIENT_SIDE_RENDERING

# 5. og image
curl.exe -s -o NUL -w "%{http_code} %{content_type}`n" http://localhost:3222/opengraph-image
```

## 8. Evidence index

| path | contents |
|---|---|
| `raw/baseline-cls.json` | pre-fix 12-cell CLS, per-cell `hri`/`inputs`, bailout + mainChars + TTFB |
| `raw/after-cls.json` | post-fix 12-cell CLS with residual shift attribution, plus console/network clean result |
| `raw/baseline-ttfb.txt`, `raw/baseline-ttfb-bailout.txt` | pre-fix TTFB / bailout / mainChars |
| `raw/baseline-html-{root,map,data,trends}.html` | pre-fix served HTML (1 bailout each, 0 `<h1>` on 3 routes) |
| `raw/after-html-{root,map,data,trends}.html` | post-fix served HTML (0 bailout, 1 `<h1>` each) |
| `raw/after-ttfb-bailout.txt` | post-fix TTFB / bailout / mainChars |
| `raw/filters-verify.json` | F1 filter/search-param verification across all four routes |

## 9. Not done / not measured

- The hero `<h1>` data-gating (residual ~0.019 at 390) was left in place: it is
  data-dependent copy (the live count is the headline), it is under budget in
  every measured cell, and it was not an F1–F6 item.
- The `live:false` path of the health card (F5's worst case) is unreachable while
  `/api/health` reports `live:true`, so it was not exercised end-to-end; F5 was
  sized from the diagnosis's measured 377 px, not re-measured this pass.
- The 768–1023 px band (where the `<h1>` wrap could add height) is outside the 12
  required cells and was not measured.
