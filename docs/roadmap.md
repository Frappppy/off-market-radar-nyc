# Roadmap — Off-Market Radar NYC

Status: **Tier 1 built, gated, not yet deployed** — see "Build status — Tier 1"
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

Built on branch `main` (uncommitted at time of writing). Deployment is a separate
step: **the SQL migration has not been applied to production and the site has not
been redeployed** — see `docs/apply_tier1_migration.md`, which carries the apply
order and the two hazards that make the order matter.

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
"gone" from "not scraped this time".

*Open decision:* the guard defaults to `window_days = 0` (exact newest cohort).
That is what removes the stale rows, but it also means every row's date *is* the
newest, so the per-listing "last seen N days ago" label reads "today" for the
whole cohort and only becomes informative if the window is loosened. `window_days`
is a live query param, so this is a one-constant change rather than a redeploy.

**1.2 — price-history panel.** Clicking a pin, a table row, or a keyboard-focused
row opens a panel with a price sparkline, every recorded reduction with its date,
DOM, $/sqft, the motivation reason, last-seen, and the outbound link. Backed by
the new `vw_listing_history` view and `GET /api/listing/[id]`. No new data
collection. Requires the view *and* its `GRANT` in production; until then the
endpoint degrades to `{history: [], unavailable: true}` and the panel says so
rather than erroring the map.

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

**Known gaps.** `/api/listing` returns a single `unavailable` shape for every
error while the panel asserts a specific cause, so a connection timeout would
render a false explanation. The frozen-CSV fallback echoes `window_days` without
applying it (harmless today: the sample holds one snapshot date). Both are
recorded here rather than silently shipped.

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

1. ~~**Tier 1**~~ — **built 2026-10-16** (see "Build status — Tier 1"; SQL not yet
   applied to production, site not yet redeployed). Three quarters of it was
   small, and 1.1 turned out to be closer to a bug than a feature.
2. **Tier 2.1 change feed** — the headline feature; makes the daily pipeline the
   visible product.
3. **Tier 2.2**, then **Tier 3** as retention becomes the constraint.
