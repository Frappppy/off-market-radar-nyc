# Tier 1 — independent UI verification

Run: 2026-10-16, after the `design-qa` subagent wedged (no artifact after 16:00; its
orphaned `next start -p 3111` was reaped). This pass was executed directly by the
router so the Tier 1 visual/behavioural gate was not left unrun.

## Environment

- Production build (`npm run build` → exit 0), served with `next start -p 3310`.
- Live Neon database (the repo's configured read-only role) — not stubs.
- Chrome 155 via the chrome-devtools MCP: 1280x900, and an emulated mobile
  viewport `390x844x2,mobile,touch`. Viewport reported back as `[390,844]`.
- Screenshots: `data-390.png`, `map-390.png`, `trends-390.png` (this directory);
  `data-1280.png` in `../raw/`.

## Verified — 1.1 recency / health

- `/data` default at 1280: **133** filtered rows, 25 per page, "Page 1 of 6",
  defaults High+Medium and DOM ≥ 60, no console errors, `scrollWidth - clientWidth = 0`.
- The ingestion health card on `/data` matches `GET /api/health` field by field:

  | card | API |
  | --- | --- |
  | Oct 16, 06:07 UTC | `finished_at 2026-10-16 06:07:44.532607+00` |
  | 1,011 rows loaded | `records_loaded 1011` |
  | Oct 17, 10:00 UTC | `next_run_at 2026-10-17T10:00:00.000Z` |
  | cron `0 10 * * *` | `cron 0 10 * * *` |
  | 1,011 of ~22.8k, 4.4% | `tracked 1011`, `market_reference 22801`, `coverage_pct 4.4` |
  | 2 ok / 0 failed | `runs_ok_30d 2`, `runs_failed_30d 0` |
  | 2 daily snapshots | `snapshot_days 2` |

## Verified — 1.3 shareable filter links

- `?score=` (present but empty) → all three score boxes unchecked, note
  "No score selected — showing all scores.", **160** rows, "Page 1 of 7"
  (absent `score` still means the defaults — matches the server).
- `?score=High&min_dom=90&sort=days_on_market&dir=-1` → slider 90, only High
  checked, `DOM▼` active, rows sorted 847 / 480 / 408, **43** rows, "Page 1 of 2".
- `?score=High,Medium&min_dom=0&sort=days_on_market&dir=-1&page=3` → "Page 3 of 7",
  URL preserved, rows descending (171 / 171 / 169).
- Clicking "Next →" → URL becomes `...&page=4` and the pager reads "Page 4 of 7".
- Client-side only: `/data` fetches once (`/api/deals?score=High,Medium&min_dom=60&limit=500`)
  and sorts/paginates in the browser.

## Verified — 1.2 detail panel

- Row click opens the panel; the history fetch degrades honestly to
  "price history unavailable — the history view is not granted yet" (expected until the
  view + GRANT are applied to production).
- Close removes the panel (13 → 7 elements matching "PRICE HISTORY"; the remaining 7
  are the page's own caption text).
- At 1280 the Close button hit-tests to itself.
- `/api/listing/<id>`: `400 {"error":"invalid listing id"}` for `a b`, `a!b`, and a
  70-char id; `200 {"unavailable":true}` for a valid-shaped id. The earlier claim that
  this endpoint returns 400 for invalid ids is **correct**; my first probe used ids that
  are legal-shaped, so my contradiction of it was wrong.

## Verified — S4 hit-area fix on /map

- The only MapLibre controls are the zoom group at the **top-left**
  (`[339,129]` at 1280, `[27,719]` at 390) and attribution bottom-right.
  There is no `.maplibregl-ctrl-top-right` element, so nothing can overlap the panel's
  Close button. `133 of 1011 shown · click a pin for the deal card`.

## Verified — 390px mobile

- `/data`, `/map`, `/trends`: `scrollWidth - clientWidth = 0` and no console errors.
- Tapping a row scrolls the panel into view; the Close button sits at `y=93`, clears the
  65px sticky header, is fully on screen, and hit-tests to itself.
- `Copy link` appears **once** per page.

## Defects found in this pass, and fixed

| # | Defect | Evidence | Fix |
| --- | --- | --- | --- |
| A | `?min_dom=abc` silently served the **frozen sample** | 13 rows, `live:false`, dates `2026-10-15` | `site/app/api/deals/route.ts` — `minDom: numOrNull(...)` instead of bare `Number()`; now 157 rows, `live:true`, `2026-10-16`. `min_dom=61` still narrows to 133. |
| B | `/data` asserted an empty result while loading | cold load: t≈1.5s `No listings match the current filters.` + `Download 0 rows as CSV` + `0 shown`, while 133 listings matched | `site/app/data/page.tsx` — `loaded`/`loadError` gate the empty state, the CSV button ("Preparing CSV…"), the intro sentence, and `shown`; fetch failure is now distinct from an empty result. Verified: `Loading listings…` → `133 rows` after ~1.6s, no false claim. |
| C | `/data` had two identical `Copy link` buttons | `copyLinks: 2` (header + filter panel); `/map` and `/trends` have 1 | removed the header duplicate from `data/page.tsx`; the filter-panel one (documented rationale, shared by every page) stays. Verified `copyLinks: 1`. |
| D | On mobile the panel opened below the fold, unreachable | 390px: Close at `y=1878` in an 844px viewport, `onScreen:false` — a tap looked like a no-op | `data/page.tsx` — `scrollIntoView` on pick, narrow screens only, `scroll-mt-20` to clear the 65px sticky header. Verified Close at `y=93`, `hitTestsToButton:true`. (First attempt used `scroll-mt-4` and put the button *under* the header — caught by hit-testing, not by eye.) |
| E | Frozen-copy path ignored the recency window it advertises | code reading: `window_days` was echoed while `applyFilters` saw the whole sample | `route.ts` — fallback now keeps only the sample's newest `snapshot_date` when `windowDays <= 0`, mirroring the live guard. **Not exercised**: needs a real DB outage. |

## Gaps — not verified here

- Pin-click → panel on `/map` (control **geometry** was checked, not the click path).
- The loading fix was verified against a local cold load, not a real Vercel+Neon cold start.
- Production `vw_listing_history` + its GRANT are still unapplied, so the panel's
  populated (non-empty history) path remains stub-verified only.
- The `/api/listing` error path maps every failure to the same shape. A DB error that is
  *not* "view not granted" would still be reported to the user as "not granted yet".
  Deliberately left as-is (queue S-4); needs a `reason` field plus a change in `SideCard`.
- Pre-existing a11y defects in `Filters.tsx` (9 unlabelled fields) untouched — outside Tier 1.
- The `window_days` default question (see `docs/roadmap.md`) is still open.
