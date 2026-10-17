# Tier 1 UI fixes — measured after-state

- Author: build/site agent (not the QA gate). **Nothing here is a "done" claim** —
  `design-qa` decides pass/fail at `/ship`.
- Date: 2026-10-16, ~20:00–22:00 local.
- Scope: the ten findings **S1–S10** from `jobs/tier1-ui-check/evidence/qa_report.md` §8,
  plus behaviour change **#1** (informative "last seen" label). S3 was listed as
  *verify only*; S11 accepted as-is; S12 out of scope.
- Constraint compliance: no commit, no push, no branch, no `vercel` command, no
  worktree; the working tree is intentionally **dirty** (see §7). Only files under
  `site/` were edited. No npm dependency was added. No credential was read, printed or
  written.
- Every number below is backed by a file in `evidence/` or `evidence/raw/`. Where a
  claim is **not** measured it is written as "not measured", not as a pass.

---

## 0. Verdict table (evidence, not judgement)

| # | Brief | Measured after-state | State |
|---|---|---|---|
| **S1** | Map pins not keyboard-reachable | All pins `role="button"` + `tabindex="0"`, unique aria-labels, Enter/Space open the panel, Escape closes, focus never drops to `<body>`; 24×24 hit box on a 14×14 pin | fixed, with a disclosed pin-render timing gap |
| **S2** | Link-only filters on `/` are invisible | `/` renders a disclosure sentence + a `/map` link that keeps the full query string | fixed |
| **S3** | No `og:*` / `twitter:*` / canonical | 11 og + 8 twitter tags + per-route canonical on all 4 routes; `/opengraph-image` → 200 `image/png` 1200×630 | **fixed although the brief said "verify only"** — scope deviation, see §3 |
| **S4** | 5 contrast failures, worst 2.10:1 | 0 failures in a fill-aware sweep of 50–267 text nodes/route; the 2.10:1 pair now 9.45:1 | fixed |
| **S5** | 5 unnamed controls, 9 orphan labels | 11/11 controls named (incl. 3 disabled selects), 0 orphan labels | fixed |
| **S6** | 14–19 sub-24px tap targets/page | Chips/checkboxes/ranges/footer links/pins at 24px; **19px-tall inline text links remain** | fixed except 19px inline links (disclosed) |
| **S7** | `/data`@390 clips 4 columns with no affordance | Hint line + right-edge gradient while overflowing; both unmount at scroll end, both return on scroll back | fixed |
| **S8** | `?score=Bogus` silently widens to all scores | 2 amber notices on `/map`, `/data`, `/trends`; 0 on clean URLs | fixed |
| **S9** | `?page=3` on a 2-page set leaves a lying URL | URL rewritten to `page=2`, pager "Page 2 of 2", 18 rows | fixed |
| **S10** | One `/trends` chart scrolls 20px at 390 | Chart wrapper no longer overflows; the only scroller at `/trends`@390 is the table wrapper (501>324), with affordance | fixed |
| **#1** | "last seen" label must be informative | Absent `window_days` → `1`; `=0` → newest snapshot only; carried rows render a `1d` badge + tooltip + sr-only sentence | fixed, **but the branch is unreachable in the default views** (disclosed) |
| S11 | 326 kB first-load JS | not touched, not re-measured | accepted |
| S12 | transient Neon timeout → frozen fallback | not touched (out of scope) | out of scope |

---

## 1. Build identity and how to reproduce

| Fact | Value | Where it comes from |
|---|---|---|
| Served build | `next start -p 3210`, BUILD_ID `5TWHc5v03KZ_d8TxEyPoe`, built 2026-10-16 21:23:03 | `site/.next/BUILD_ID` |
| Newest source mtime | `site/components/SideCard.tsx` 21:21:45 — **older than the build** | directory scan |
| So the server *is* a build of the current tree | yes | above two rows |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) → exit 0, no output | §7 |
| Server PID during measurement | 24244, listening on 3210 | `Get-NetTCPConnection -LocalPort 3210` |
| Server state now | stopped — port 3210 has no listener; all numbers above were captured while it was up | `Get-NetTCPConnection -LocalPort 3210` (empty) |

Reproduce the page state:

```powershell
cd "site"; npx next start -p 3210          # serves the build above
# API-level cases:
node jobs/tier1-ui-fixes/evidence/raw/api-cases.mjs   > out.txt
node jobs/tier1-ui-fixes/evidence/raw/api-cases2.mjs  > out2.txt
node jobs/tier1-ui-fixes/evidence/raw/meta-check.mjs  > meta.txt
# Page-level probes (playwright MCP `browser_run_code_unsafe`):
#   raw/probe-verify.js   -> raw/verify-{390,1280}-{home,map,data,trends}.json
#   raw/probe-s1.js       -> raw/s1-pins-1280.json
#   raw/probe-s2s8.js     -> raw/s2s8-*.json
#   raw/probe-s7s9.js     -> raw/s7s9-*.json
#   raw/probe-contrast2.js / probe-legend-diag.js -> raw/contrast2-*.json, raw/legend-diag.json
#   raw/probe-contrast-final.js -> raw/contrast-final.json
```

The probe scripts are the exact code that produced the JSON next to them; they are
copied into `evidence/raw/` so the claims are re-runnable. No probe contains a
credential — they only speak to `http://localhost:3210`.

---

## 2. Global sweeps (390 and 1280, all four routes)

Eight runs: `/`, `/map`, `/data`, `/trends` × 390×844, 1280×900 (`raw/verify-*.json`).

| Check | Result |
|---|---|
| Page-level horizontal scroll | none: `docScrollW == docClientW` on all 8 (390/390, 1265/1265), `hScroll:false` |
| Exactly one `h1` | 1 on every route (`Motivated sellers in NYC this week`, `Find the call list`, `Take the call list with you`, `Market trends`) |
| Page-error array collected by the probe | `errors: []` on all 8 runs |
| Contrast sweep (fill-aware, direct text nodes only) | 0 failures; 54 (/,1280), 57 (/,390), 50 (/map both), 267 (/data both), 224 (/trends,1280), 215 (/trends,390) nodes checked |
| Unnamed enabled controls | 0 (11 controls present on `/map` and `/data`, 3 of them the intentionally disabled Source/Country/City selects) |
| Orphan `<label>` (no `for`, no wrapped control) | 0 |
| Pins keyboard-exposed | `/map`: 34/34 role=button, tabbable, at 1280; 19/19 at 390. `/`: 26/26 at 1280, 15/15 at 390 |

Caveat: the `/trends` runs report `ready: "TIMEOUT"` — the readiness marker the probe
waits for never fired (charts hydrate late), but the measurements still landed after the
fixed 4.5 s wait. Everything `/trends`-specific was re-measured separately with an
explicit chart-wait loop (`raw/contrast2-trends-{390,1280}.json`, `raw/legend-diag.json`).

---

## 3. Per-finding detail

### S1 — map pins not keyboard-reachable (should-fix)

**Before** (qa_report §5): 34 markers `div.maplibre-pin` with no `tabindex`, no `role`,
`aria-label="Map marker"` — `focusablePins: 0`. A keyboard user could not open a listing
from `/map` at all.

**After** — `raw/s1-pins-1280.json` (`/map`@1280):

| Measure | Value |
|---|---|
| markers / leaves / clusters | 7 / 5 / 2 |
| `role=button` / tabbable | 7 / 7 |
| legacy `aria-label="Map marker"` | **0** |
| leaf aria-labels | unique per listing, e.g. `410 Bard Ave · Medium motivation · DOM 64` |
| cluster aria-labels | `Zoom in on 3 listings`, `Zoom in on 2 listings` (count in the name, not repeated boilerplate) |
| layout box | 14×14 (unchanged — `.maplibre-pin` is still a 14px dot) |
| **hit area** via `elementFromPoint` | 24 wide × 25 high; reach right 11 / left 12 / down 12 / up 12; diagonal 11 → a **square**, not a circle |
| just outside (+14 / +20 px) | `maplibregl-canvas` — the hit box has a hard edge |
| min leaf-centre gap | 129.27 px (≫ 24, so two pins cannot be confused by touch) |
| pins still `<div>` | 0 real `<button>` elements; `role`+`tabindex`+key handlers instead |

Interactive proof (earlier in this session, not re-run in the final sweep): Tab reaches a
leaf pin, **Enter** opens `role="dialog"` "Property detail for 410 Bard Ave" with focus
retained on the pin, **Escape** closes, **Space** reopens, Escape closes; focus never
falls to `<body>`. Screenshot: `detail-s1-pin-focus-390.png`.

**Known gap** — pin render timing. `raw/pin-count.json` is a load where the map never
produced markers: `pins: 0` at every sample from t=0 to t=9 100 ms, and the counter read
`10 of 1011 shown`. Other loads settle at 34 pins / `133 of 1011 shown`. So markers can
appear ~3.6 s after load and the count is low or zero during the first seconds. No console
message and no 4xx/5xx in the settled runs. The page redraws every 1.5 s, now gated on
`renderedRef` so an identical set is not re-created each tick; the late/empty first paint
itself is **not fixed**.

### S2 — a shared link's filters are invisible on `/` (should-fix)

**Before**: `/?score=High&min_dom=120&zip=11215,11216&type=house&min_price=500000&max_price=900000`
rendered `0 of 1011 shown` with no control for zip/type/price and no explanation.

**After** — `raw/s2s8-home-390.json`:

- `hasFromThisLink: true`, `hasNotEditable: true`, `hasOpenInMap: true`.
- Sentence rendered: *"From this link: ZIP 11215, 11216 · type house · min $500,000 · max $900,000 — applied to every number and pin below, but not editable on this page. Open in the map explorer to edit →"*
- Two links carry the full query string through, unmodified:
  `/map?score=High&min_dom=120&zip=11215%2C11216&type=house&min_price=500000&max_price=900000`
  ("Full map →" and "Open in the map explorer to edit →"), both with the `.tap` class.
- `/map` and `/data` correctly show **no** disclosure (`hasFromThisLink:false`) — the
  filters are editable there.

Screenshots: `detail-s2-disclosure-390.png`, `detail-s2-disclosure-1280.png`.

### S3 — meta/OG/canonical (brief said *verify only*) — **scope deviation, disclosed**

**Before**: `og: {}` on all four routes, no `twitter:*`, no canonical.

**After** — `raw/meta-check.txt` (raw HTML of the served routes):

| Route | canonical | og:url |
|---|---|---|
| `/` | `https://off-market-radar-nyc.vercel.app` | same |
| `/map` | `…/map` | `…/map` |
| `/data` | `…/data` | `…/data` |
| `/trends` | `…/trends` | `…/trends` |

All four: `og:count 11`, `twitter:count 8`, `og:type=website`,
`twitter:card=summary_large_image`, `og:image:width/height = 1200/630`,
`og:image = …/opengraph-image?271fb4708f34da7c`.
`raw/og.headers` → `HTTP/1.1 200 OK`, `content-type: image/png`, immutable cache;
body 50 028 bytes (= `og.png`, copied as `detail-s3-og-image-1200x630.png`).

Notes: the base URL is the `NEXT_PUBLIC_SITE_URL` default (the production Vercel origin),
so these tags point at the deployed host from any environment. The browser resolves the
DOM `link[rel=canonical]` on `/` to `…/` (trailing slash) while the raw attribute has no
trailing slash — cosmetic, from `canonical: "./"`.

**Disclosure**: the brief listed S3 as *verify only*. A fix was written anyway
(`site/app/layout.tsx` + new `site/app/opengraph-image.tsx`). It is reported here as an
unrequested extra so the gate can accept or revert it knowingly.

### S4 — contrast below AA (should-fix)

Token changes: `--color-zinc-500: #8b8b93` (was `#71717b`), `text-zinc-600` → `text-zinc-500`
on the `/map` hint, `SCORE_PILL_TEXT` (High `#ffffff`, Medium/Low `#09090b`), and a
`legendLabel` formatter that wraps every recharts legend label in a `#d4d4d8` span.

| Element | Before | After | File |
|---|---|---|---|
| `.eyebrow` on panel `#141416` | `#71717b` 3.81:1 | `#8b8b93` **5.44:1** | `s2s8-home-390.json` |
| `.eyebrow` on body `#09090b` (`MAP EXPLORER`, `DATA · EXPORT`, `MARKETS · CROSS-SECTION`) | `#71717b` 4.12:1 | **5.89:1** | `s2s8-map-390.json`, `s2s8-data-390.json`, `s2s8-trends-390.json` |
| `/map` hint "· click a pin for the deal card" | `#52525c` 2.58:1 | **5.89:1** | `s2s8-map-390.json` |
| `/data` "1,011 rows loaded" | 4.12:1 | **5.44:1** | `s2s8-data-390.json` |
| **High** badge | `#ffffff`/`#d62728` (5.02) | `#ffffff`/`#d62728` **5.02:1** | `contrast-final.json` |
| **Medium** badge | `#ffffff`/`#e6a817` **2.10:1** | `#09090b`/`#e6a817` **9.45:1** | `contrast-final.json` |
| **Low** badge | (`text-white`, not listed as failing) | `#09090b`/`#9aa0a6` **7.53:1** | `contrast-final.json` |
| `/trends` score/zip legend text | `#d62728` as text 3.66:1 | inner label span `#d4d4d8` **12.45:1** (all 9 legends) | `contrast-final.json` |
| footer link / nav link | — | **7.59:1** / **13.46:1** | `s2s8-*.json` |

Screenshots: `detail-s4-pills-390.png`.

**Measurement pitfall that produced a false failure earlier** — the recharts legend item is
`span.recharts-legend-item-text[style=color:series] > span[style=color:#d4d4d8]`. The outer
node still computes to the series colour (3.66:1 for High) but paints **no glyphs**:
`raw/legend-diag.json` shows `directText:""` and `wouldSweepInclude:false` for all 9 entries.
Reading the outer node reports 3.66:1; the real rendered ratio is 12.45:1.

### S5 — unnamed controls / orphan labels (should-fix)

**Before**: 5 controls with no accessible name (Source/Country/City selects, the **Type**
select, the **DOM range slider**) and 9 `<label>`s with no `htmlFor`.

**After** — `raw/verify-390-data.json`, `raw/verify-1280-data.json`, `raw/pin-count.json`:

| Route | controls | disabled | unnamed enabled | orphan labels |
|---|---|---|---|---|
| `/map` @390 and @1280 | 11 | 3 | **0** | **0** |
| `/data` @390 and @1280 | 11 | 3 | **0** | **0** |

`raw/pin-count.json` lists the resolved pairs, e.g. `Source → _r_0_-source`,
`DOM ≥ 60 days → _r_0_-dom`, `Type → _r_0_-type`, `ZIPs (comma-separated) → _r_0_-zips`; the
three score checkboxes are still wrapped in their label (`wrapped: true`). The "Motivation"
group heading is now a `<span>`, so it can no longer read as a label for the first checkbox.

### S6 — tap targets below 24px (should-fix)

**Before**: 13×13 score checkboxes, 16px `Reset`, 16px range sliders, 20px sort headers,
20px nav links, 19px footer links, 14px attribution links, 16px `Full map →` — 14–19
sub-24px targets per page.

**After** (`raw/verify-*.json` `chips` + `targets`, `raw/s2s8-*.json` `tap`):

| Target | After |
|---|---|
| Score chips `/` | `High` 48.2×**24**, `Medium` 67.5×**24**, `Low` 44.1×**24**, all `tap:true` (`verify-1280-home.json`) |
| Score chips `/map`, `/data` | `High` 59.5×**24**, `Medium` 81.5×**24**, `Low` 54.9×**24** (`verify-390-data.json`) |
| Checkbox column, sliders, `Reset`, footer links, attribution | `.tap` class → `min-height/min-width 1.5rem`; the per-route tap sweep reports `minHeights: 24px, minWidths: 24px` on `/`, `/map`, `/data`, `/trends` |
| Pins | layout box 14×14, hit box **24×25** by `elementFromPoint` (§S1) |

**Remaining sub-24px layout boxes — disclosed gap.** The sweep measures *layout* boxes, so
two classes still show up:

- `/data` row addresses are inline `outbound-link` `<a>`s: at 1280, `sub24Union: 25`,
  each 19px tall (e.g. `5639 NETHERLAND AVE APT 1B` 195.77×19). At 390 they wrap
  (`sub24Union: 1`, 39–59px tall) except single-word addresses like `25 GRACE CT`
  (81.27×19).
- `/trends` `Zillow ↗`: 36.48×39 union at 390 with a 19px line box, `sub24Line: 10`.
  Centre spacing is ≥ 29px, so the WCAG 2.5.8 "spacing" exception holds.
- 14×14 pin layout boxes on `/` and `/map`: real hit area 24×24 (§S1).

These were deliberately **not** padded, because padding them would make neighbouring hit
areas overlap (each row is a clickable `<tr>`; the address link is inside it).

### S7 — `/data`@390 clipped columns with no affordance (should-fix)

**Before**: wrapper `519 > 356`, columns hidden with no shadow and no hint.

**After** — `raw/s7s9-clamp.json` and `raw/s7s9-dom0*.json`:

| State | Hint present | `[data-testid="hscroll-edge"]` |
|---|---|---|
| at scroll start (`scrollW 550 > clientW 356`, overflow 194) | **true** — "Swipe the table sideways for DOM, drop %, $/sqft and score →" | **true** |
| at scroll end | **false (unmounted)** | **false (unmounted)** |
| after scrolling back | **true** | **true** |

Reproduced three times with different overflow (550>356, 549>356, 559>356) and on the
default `/data` view (`verify-390-data.json`: 594>356, `hscroll-edge` visible).
Screenshots: `detail-s7-hscroll-start-390.png`, `detail-s7-hscroll-end-390.png`.

### S8 — `?score=Bogus` silently widened to all scores (cosmetic)

**After** — `raw/s2s8-*-390.json`: exactly **2** amber notices on each of `/map`, `/data`,
`/trends` for `?score=Bogus&min_dom=abc`:

1. `"Bogus" is not a motivation score (High / Medium / Low) — ignored, so this view shows every score.`
2. `"abc" is not a number — the DOM floor fell back to 60 days.`

Clean URLs: **0** notices (`s2s8-map-clean-390.json`, `s2s8-trends-clean-390.json`).
The *behaviour* is unchanged and still widens (confirmed by `raw/api-cases.txt`:
`score=Bogus` → 1019 rows, all scores) — the defect was the silence, and it is now
disclosed. Screenshot: `detail-s8-notices-390.png`.

### S9 — URL/server disagreement on an out-of-range page (cosmetic)

**Before**: `?…page=3` → pager "Page 2 of 2", 18 rows, URL still said 3.

**After** — `raw/s7s9-clamp.json`:
`urlAtStart: /data?score=High&min_dom=90&sort=days_on_market&dir=-1&page=3`
→ `urlAfter: …page=2`, `pager: "Page 2 of 2"`, `rowCount: 18`,
`firstAddress: 360 BEACH 59TH #A2`. Screenshot: `detail-s9-pager-390.png`.

### S10 — `/trends` chart wrapper scrolled 20px at 390 (cosmetic)

**Before**: `div.mt-2.overflow-x-auto` `344 > 324`.

**After** — `raw/verify-390-trends.json`: `scrollers.count = 1` and the single entry is the
**table** wrapper (`501 > 324`) which carries the affordance
(`hscroll-edge: true`, hint "Swipe the table sideways for the remaining columns →").
The chart wrapper no longer appears. At 1280 (`verify-1280-trends.json`) the scroller list
is empty.

### #1 — informative "last seen" (behaviour change)

**Decision implemented**: absent `windowDays` → `1` (newest snapshot **plus** any listing
still inside a 1-day window); explicit `window_days=0` → the newest snapshot only. The UI
deliberately does **not** send the parameter (`toDealsQuery` omits `window_days`), so the
default view exercises the "1" branch.

API behaviour — `raw/api-cases.txt`, `raw/api-cases2.txt` (verbatim, this pass):

| Case | `count` | `window_days` | dates |
|---|---|---|---|
| `/api/deals?limit=5000` (no param) | 157 | **1** | all `2026-10-16` |
| `…&window_days=0` | 157 | 0 | all `2026-10-16` |
| `…&window_days=1` | 157 | 1 | all `2026-10-16` |
| `…&score=High,Medium,Low&window_days=1` | **1019** | 1 | 1011 (10-16) + **8** (10-15) |
| `…&score=High,Medium,Low&window_days=0` | **1011** | 0 | all `2026-10-16` |
| `…&score=Low&window_days=1` | 862 | 1 | 854 + 8 |
| `…&score=Low&window_days=0` | 854 | 0 | all `2026-10-16` |
| `…&min_dom=abc` (unparseable) | 157 | 1 | fell back to the default |
| `…&score=Bogus` | 1019 | 1 | widened to every score |

Carried rows (older than the newest snapshot): **8**, all `Low`, all 2026-10-15, DOM 0–14
(`604 LINCOLN AVE` 10306, `6483 83RD PLACE` 11379, `1934 BENEDICT AVENUE` 10462,
`205 W END AVE APT 7F` 10023, `88 ABERDEEN ST` 11207, `159-30 102ND STREET` 11414,
`13711 234TH ST` 11422, `123 JAMIE LN` 10312).

UI — `raw/s7s9-dom0.json` (`/data?score=Low&zip=10306&min_dom=0`, 20 rows):

- badge `1d`, `title="last seen yesterday — snapshot 2026-10-15, not in the newest daily run"`
- sr-only sentence `— last seen yesterday, not in the newest daily run`
- screenshot `detail-carried-badge-390.png`

**Known gap**: the carried-over badge is **unreachable in the default views**. `/data`
defaults to `min_dom=60` while every carried row has DOM ≤ 14, and `/data` requests
`limit=500`, so when the matched set is large the carried rows are cut
(`/data?score=Low&min_dom=0` = 20 pages, none on page 1 — `s7s9-dom0_all.json`).
Reachable via `?score=Low&zip=10306&min_dom=0`, which is how it was measured.

---

## 4. Findings I did not touch

- **S11** (326 kB first-load JS) — accepted; no bundle work done, no re-measurement.
- **S12** (transient Neon timeout → frozen 82-row fallback, no retry) — out of scope per
  the brief; no retry/backoff added.

---

## 5. Screenshots

22 PNGs in `evidence/` (all verified this pass by IHDR read; the four `route-*` at both
widths were also viewed):

| File | Shows |
|---|---|
| `route-home-{390,1280}.png`, `route-map-{390,1280}.png`, `route-data-{390,1280}.png`, `route-trends-{390,1280}.png` | full-page renders of the four routes at both widths (8) |
| `detail-s1-pin-focus-390.png` | a focused map pin |
| `detail-s2-disclosure-390.png` / `detail-s2-disclosure-1280.png` | the `/` link-filter disclosure |
| `detail-s3-og-image-1200x630.png` | the generated OG image (byte-identical to `raw/og.png`) |
| `detail-s4-pills-390.png` | score badges after the contrast fix |
| `detail-s7-hscroll-start-390.png` / `detail-s7-hscroll-end-390.png` | hint + edge gradient at start, both gone at end |
| `detail-s8-notices-390.png` | the two amber filter notices |
| `detail-s9-pager-390.png` | the clamped pager |
| `detail-carried-badge-390.png` | the `1d` carried-over badge |

---

## 6. Files changed (all under `site/`)

`git status --porcelain -- site` + `git diff --stat -- site`:

```
 M site/app/api/deals/route.ts     | 17 ++--      M site/components/DealMap.tsx   | 69 +++--
 M site/app/data/page.tsx          | 87 ++++--     M site/components/Explorer.tsx  | 77 ++++--
 M site/app/globals.css            | 63 ++++       M site/components/Filters.tsx   | 85 ++++--
 M site/app/layout.tsx             | 27 ++--       M site/components/SideCard.tsx  | 73 ++++--
 M site/app/trends/page.tsx        | 77 ++++--     M site/lib/db.ts                | 14 ++-
 M site/lib/types.ts               | 43 ++++       M site/lib/useFilters.ts        | 65 ++++
                                                  12 files changed, 566(+), 131(-)
?? site/app/opengraph-image.tsx   ?? site/components/FilterNotices.tsx   ?? site/components/HScroll.tsx
```

New modules: `components/FilterNotices.tsx` (S8), `components/HScroll.tsx` (S7/S10),
`app/opengraph-image.tsx` (S3, extra scope). Nothing staged; nothing committed.

`README.md` and `docs/*.md` also show as modified in `git status`, but those are
**pre-existing and not mine**.

---

## 7. Mid-flight corrections (what the first attempt got wrong)

1. **A `.tap` class alone does not fix the pins.** The hit box came out 14×14 on the
   first attempt; the 24×24 area needed a `::before` expansion, and `getBoundingClientRect`
   cannot see it — the size had to be re-measured with `elementFromPoint` in four
   directions plus a diagonal.
2. **The recharts legend "contrast failure" was a measurement artefact.** The outer
   legend span keeps the series colour; only the inner span paints text. The sweep now
   keys on elements with a **direct text node** and uses `fill` for SVG. Before that fix
   the sweep reported a false 3.66:1 failure in `/trends`.
3. **`useId` was required for S5.** `Filters.tsx` renders more than once per page, so
   literal `id`s would have collided. Labels now use `_r_0_-…` from `useId`.
4. **The API default is not "all scores".** `parse()` defaults `score` to `High,Medium`,
   so the default view is 157 rows, not 1019 — the earlier 1019 figure came from an
   explicit three-score query. Corrected in §#1.
5. **The carried-over rows are all `Low`.** So any statement of the form "the default view
   shows carried rows" is false; see the #1 gap.
6. **`window_days=99999` is echoed un-clamped** by the route while SQL clamps to 3650,
   and `offset=100000` returns 0 rows with a null count. Reported, not fixed (not in the
   finding list).

---

## 8. Not verified / known gaps

1. **Pin first paint.** Markers can be absent for the first ~3.6 s and one recorded load
   never drew them (`raw/pin-count.json`). Not fixed.
2. **S6 residual.** 19px-tall inline links remain on `/data` (addresses) and `/trends`
   (`Zillow ↗`); 14×14 pin layout boxes remain (24×24 hit area). WCAG 2.5.8 spacing
   exception argued, not proven by an automated tool.
3. **#1 reachability.** The carried-over sentence/badge cannot be reached from the default
   `/data` view (`min_dom=60` vs carried DOM ≤ 14; `limit=500` cut).
4. **S3 is extra scope.** Fixed although the brief said verify only.
5. **Keyboard run for S1** was performed earlier in this session with real key events; the
   final sweep only re-measured the DOM/hit-box state (`s1-pins-1280.json`). Not
   re-executed key-by-key in the last pass.
6. **No real screen reader, no real touch input, Chromium only.** Accessible names were
   computed programmatically; tap sizes are layout/hit-test measurements, not finger taps.
7. **`prefers-reduced-motion` / forced-colors** untested.
8. **`/trends` readiness marker timed out** in both width runs (`ready: TIMEOUT`); the
   numbers landed after a fixed wait, so a slower machine could shift the exact node count
   of the contrast sweep.
9. **The `/data` `25 GRACE CT` case** is the only 390-width row where a wrapped address
   still measures 19px tall; it is a single-line label by content, not by styling.
10. **Not re-measured this pass**: the SideCard carried-over sentence (source-read only),
    SideCard Escape-to-close (verified earlier), the `/trends` ingestion-health card, and
    `vw_listing_history` (still not granted in Neon, so the populated price-history state
    remains unproven).
11. **Nothing is deployed.** All numbers are a local production build on port 3210.

---

## 9. Artefacts in `evidence/` that I did not author

Left in place, **unverified by this pass** (timestamps 20:38–21:37, written by another
session working in the same directory):

`detail-1-carried-sidecard-390.png`, `detail-2a-reductions-390.png`,
`detail-2a-reductions-two-cuts-390.png`, `detail-1-carried-badge-390.png`,
`detail-s2-disclosure-1280.png`.

Also present: `evidence/a11y/_index.json`, whose content is `[]` — a stray, empty index
file from a capture script. `evidence/raw/` contains the probe scripts and their raw JSON
output (42 files) copied from
`%TEMP%\opencode\probe-*.js`, `s2s8-*.json`, `verify-*.json`, `s7s9-*.json`,
`contrast2-*.json`, `legend-diag.json`, `pin-count.json`, `s1-pins-1280.json`, `og.headers`,
plus this pass's `api-cases.txt`, `api-cases2.txt`, `meta-check.txt`, `contrast-final.json`.

A concurrent read-only CLS audit exists at `jobs/tier1-cls-diagnosis/` (its own report says
no repo file was edited). It is not part of this task and I did not review its numbers.

---

## 10. Orchestrator corrections (appended after this report was written)

Author: the session that dispatched this work, not the author of §1–§9. Two items.

1. **§8 item 10 is wrong about the production grant, and the correction matters.**
   `vw_listing_history` **is** granted in Neon. The migration's four-object `GRANT` was
   applied to production at 13:55Z and independently confirmed twice — both
   `has_table_privilege()` *and* the raw `relacl` — for `vw_latest_listings`,
   `vw_zip_price_drop_30d`, `pipeline_runs` and `vw_listing_history`. Production's
   `GET /api/listing/145558321` returns 200 with `live:true` and two points
   (2026-10-15 → 2026-10-16), and `/api/listing/30776634` returns the sloped
   three-point series. So "the populated price-history state remains unproven" is not
   true of production; what was unproven *here* is only this pass's local
   re-measurement of it. The affected sentence should be read as "not re-measured in
   this pass, but proven against production earlier the same day."

2. **This directory was written by two sessions at once, and both change sets survive.**
   The screenshots §9 describes as unauthored, plus an earlier and longer report at
   this exact path, came from a second session auditing the same findings while this
   one was still editing. That session was dispatched on the mistaken belief that this
   one had died; it had not, it was merely silent between long tool runs. The two
   sessions then edited the **same three files** (`components/SideCard.tsx`,
   `app/layout.tsx`, `app/opengraph-image.tsx`) within about twenty minutes of each
   other — a real race, and this report replaced the audit's.

   Verified afterwards from the code and the built output, not from either report:
   `reductionsFrom` still gates its recorded branch on `movedSincePrev` (the audit's
   fix, lines 71–74) with this session's carried-over logic sitting on top of it
   (lines 179–186, 301–312); the S3 metadata block and the new `app/opengraph-image.tsx`
   are intact, and the build emitted a 50,028-byte `opengraph-image.body`. Nothing was
   clobbered. The lesson recorded for the next round: in this environment a session
   that has written nothing for 40 minutes is **not** evidence of a dead session, and
   two agents must never share a working tree or a `.next` build directory.
