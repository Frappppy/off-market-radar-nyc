# docs/decisions.md — ADR-lite: why each irreversible choice was made

Short, dated records for decisions that are expensive to reverse. One section
each; every claim here was re-verified against the working tree on **2026-10-21**.
Deeper context: [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) (phase logs),
[REPO_MAP.md](../REPO_MAP.md) (dated baseline `6be2c61`), and each file's T0
header (`WHY:` block).

## 1. The 90 % / 5 % scoring thresholds (`motivation_score`, invariant I1)

**Context.** The product's whole thesis is "who is motivated to sell": high
days-on-market **and** a price cut. **Decision:** `High` = DOM > 90 **AND**
price drop > 5 %; `Medium` = XOR; `Low` = neither — strict `>`, null-safe (missing
DOM counts as ≤ 90, missing drop as ≤ 5 %). Constants live once in
`src/clean/score.py` (`HIGH_DOM = 90`, `HIGH_DROP_PCT = 5.0`).
**Why strict `>`:** a drop of *exactly* 5.0 % and DOM of *exactly* 90 must not
round into `High` — pinned boundary tests exist for both
(`test_drop_exactly_5_pct_is_not_high`, `test_score_one_null_safe_rules` with
`(90, 5.0) → Low`). **Consequences:** the thresholds are a *documented ceiling
choice*, not a fitted model; changing them changes score mix on the live site
(43/114/862 High/Medium/Low at first load) and requires updating
`docs/data_contract.md` §Stage 2 in the same commit — the contract, the code and
the tests must move together (I1, I2).

## 2. Two robots gates, deliberately not merged (Phase 1 finding)

**Context.** Stage 1 gates every URL twice: `robots.is_allowed_url()` on each
request (`http.ZillowClient.fetch`, plus `run`/`phases` call sites) **and**
`run._guard_redirect()` on redirect targets. Phase 1 considered collapsing them.
**Finding:** `is_allowed_url` is the **stricter** test — https-only, host
allowlist, no query strings at all, and a URL must match `SEARCH_PATH_RE` or
`/homedetails/`. The redirect guard checks only host + `DISALLOWED_PATH_PREFIXES`
(a permissive superset of accepted URLs). Merging by reusing `is_allowed_url`
for redirects would **break legal `?` redirects** — Zillow routinely redirects a
plain search URL to the same URL with a query string, which `is_allowed_url`
rejects by design (test case `…/new-york-ny/?sort=pricea → False`).
**Decision:** both gates stay; each carries a comment naming the other
(`src/scrape/robots.py` T0 `CALLERS:`, `src/scrape/run.py` above
`_guard_redirect`). The per-request gate also runs *before* `_px` detection, so
it catches un-gated `direct()` callers that the redirect guard never sees.
**Consequences:** compliance (I10) rests on the *stricter* gate for every URL we
request; the redirect guard is belt-and-braces. Known gap: the redirect guard's
wiring itself is untested (REPO_MAP §10.4) — see the verification map in
[ARCHITECTURE.md](../ARCHITECTURE.md).

## 3. Recency guard: `max(snapshot_date)`, never `CURRENT_DATE`

**Context.** `/api/deals` must drop sold/delisted listings, which stop receiving
snapshots. **Decision:** the deals query anchors on the dataset's own newest
snapshot — `(SELECT max(snapshot_date) FROM vw_latest_listings)` — instead of
comparing against today's date (`site/lib/db/deals-query.ts`, comment at the
`newest` constant; also `site/lib/db/queries.ts` for `/api/meta`).
**Why:** the daily cron misses days (free-tier runner hiccups, failed runs, and
before the first run of a day). With `CURRENT_DATE`, one missed run blanks the
map completely; with `max(snapshot_date)`, a missed run keeps showing the last
cohort and only *genuinely newer* data evicts old rows. Measured effect on
production: 1,019 → 1,011 rows (the 8 listings whose newest snapshot is not in
the newest cohort). **Consequences:** the guard can show data a day old — that
is honest (the freshness strip reports the date); it survives a missed run
without emptying the surface (assertion G of `scripts/tier1_migration_check.py`).

## 4. The frozen-CSV fallback (`site/public/data/listings_sample.csv`)

**Context.** A portfolio site must not 500 when Neon is unreachable or the
read-only role is misconfigured. **Decision:** all five API routes
(`/api/deals`, `/health`, `/meta`, `/zips`, `/listing/[id]`) catch DB errors and
answer from the bundled 82-row CSV with `live: false` — never an error page
(invariant I14; reader in `site/lib/fallback.ts`). **Why a frozen file instead
of a cache:** it is byte-identical to a real run (`jobs/smoke-scrape-20261015-084632`),
so the demo is real data; it is static, so it cannot itself fail; `live:false`
is surfaced in the UI so a fallback render is never mistaken for live data.
**Consequences:** the fallback is a single-snapshot, 82-row dataset — /api/zips'
fallback trends are honestly demo-only (stated in the route's T0 header); the
CSV's ids are what the sitemap can enumerate at build time (no `DATABASE_URL`
during `next build`).

## 5. Windows CI (`.github/workflows/daily_pipeline.yml`)

**Context.** The pipeline must run unattended daily. **Decision:** the workflow
runs on `windows-latest` with `py -3 -m venv .venv`, `pip install -r
requirements.txt`, `scripts\run_daily.py`, cron `0 10 * * *`, exactly six
secrets (`DATABASE_URL`, `DATAIMPULSE_*` ×5). **Why Windows:** the project's
verification tooling was born Windows-first (`scripts/*.ps1`, `py -3`), and the
workflow is frozen by `tests/test_workflow_yaml.py::test_schedule_and_stages`,
which asserts those exact strings — changing the runner is a coordinated change
(test + docs + deploy runbook), not a tweak. **Consequences:** CI runs the
*pipeline*, not the test suite (no `pytest` step yet — Phase 6 of the plan);
evidence uploaded by CI does not persist (runner `jobs/` dies with the runner,
so CI runs have no `jobs/` directory — known, documented in `README.md`).

## 6. Conda environment, not venv (system Python has no `ensurepip`)

**Context.** Linux dev box without root; `requirements.txt` pins 33 packages.
**Decision:** use the conda env `off-market-radar` via its **literal
interpreter path** `~/.anaconda3/envs/off-market-radar/bin/python` in every
command (no shell activation), created from `~/.anaconda3/bin/conda create -n
off-market-radar python=3.14 pip -y` + `pip install -r requirements.txt`.
**Why:** the system interpreter `/usr/bin/python3` (3.14.4) ships **without
`ensurepip`** — verified 2026-10-21: `import ensurepip` → `ModuleNotFoundError`
and `python3 -m venv <dir>` fails mid-creation, so the README's original
`py -3 -m venv` recipe only ever worked on Windows. The conda env lives
*outside* the repo, so nothing needs gitignoring. **Fallback if conda goes
away:** `python3 -m venv --without-pip` + `get-pip.py` (proven working
2026-10-20, see REFACTOR_PLAN phase 0). **Consequences:** agents must use the
literal path; `.venv/` remains in `.gitignore` for Windows/CI parity.

## 7. "No file > 200 lines" (REFACTOR_PLAN D1)

**Context.** The pre-refactor tree had `parsers.py` (643, formerly the whole
stage-1 parser) and `pipeline.py` (493, formerly the stage-1 orchestrator) —
files no reviewer or agent can hold in one screen. **Decision:**
≤ 200 lines per file is the target, **300 is the hard cap**; file count may
roughly double. Comments count toward the budget (a 200-line body + a 15-line
T0 header is over target, not over the cap). **Why:** the plan's first goal is
no hallucination — a file whose whole contract fits one screen is auditable, and
`Verified by:` anchors are only credible if the rule they anchor is visible
above them. **Consequences (verified 2026-10-21):** largest `src/` file = 200
lines (`src/scrape/parsing/record.py`), largest site file = 199
(`site/components/status/IngestionHealth.tsx`); splitting a file means a
behaviour-preserving move (golden-dump gate), never a rewrite.

## 8. The 11 "duplicates" that were deliberately different (Phase 1 finding)

**Context.** Phase 1's dedupe pass found ~11 places where two implementations
looked copy-pasted but **behaved differently**. **Decision:** unify the
*implementation*, parameterise the *behaviour* — never silently reconcile.
**Examples that would have been "fixed" into a regression:**
- **Coverage % rounding:** `/api/health`'s API field rounds to exactly 1 decimal
  (`pct1FromRatio`), while the prose disclosure (`market.coverageNote` via
  `fmtPct(…, "adaptive")`) switches to whole numbers ≥ 10 % — merging the two
  would change rendered text on the live site.
- **`deals[0]` vs max:** `/api/meta`'s fallback reads `deals[0]?.snapshot_date`
  on purpose (the rows arrive newest-first there), while everything else uses
  `maxSnapshotDate()`; both are correct *for their input ordering* (see the
  NOTE block in `site/lib/dates.ts`).
- **Null-number parsing** had edge-case differences as well (empty string vs
  `null` vs `NaN` handling per call site) — preserved as parameters rather than
  normalised away.
**Consequences:** several helpers take a rounding/edge-case mode instead of
being "the one true function" — that is the point; the full count (11) and the
grep evidence are in REFACTOR_PLAN phase 1. New code should call the
parameterised helpers, not re-derive the maths.

## 9. `jobs/` evidence and `.gitignore` (correction of a stale claim)

**Context.** `jobs/tier1-migration-apply/evidence/apply.txt` (line 93) claims
commit `ca35432` added `.gitignore:54  jobs/*/evidence/`, making jobs evidence
"local-only" and that file itself untracked. That claim is **stale on both
counts** — verified 2026-10-21, and the evidence file is *not* edited because
run transcripts are immutable history. **Reality:**
- The rule now lives at **`.gitignore:58` `jobs/*/evidence/*`** with
  **`:59` `!jobs/*/evidence/*.md`** — markdown reports are deliberately **not**
  ignored (they are the cited audit trail; only screenshots/session state are).
- `jobs/tier1-migration-apply/evidence/apply.txt` **is tracked** (`git ls-files`
  lists it). The index holds **179 `jobs/` paths**, of which **135 files exist on
  disk** (16 directories) — the other 44 are the Phase-5a deletions, still
  restorable with `git checkout -- <path>` because nothing is committed yet. A
  tracked file is unaffected by ignore rules; `git check-ignore` reports "not
  ignored" for it, and only reports the pattern under `--no-index`.
- The only doc that repeated a version of the claim — `README.md`'s repo-layout
  line "(evidence, gitignored)" — was corrected in the 2026-10-21 rewrite.
**Rule going forward:** `jobs/` deletions must keep the keep-cited list
([jobs/README.md](../jobs/README.md), REPO_MAP §5.10 ⭐); everything deleted is
git-recoverable (`git checkout -- <path>`).

## 10. The Windows real-DB scripts stay whole (D1 exemption)

**Context.** D1 (§7) targets ≤ 200 lines per file, hard cap 300. Exactly three
files breach it and cannot be split honestly: `scripts/tier1_migration_check.py`
(459 ln), its bootstrapper `scripts/tier1_migration_check.ps1`, and
`scripts/live_db_check.ps1` (~1,254 ln together). They hold the repo's **only
real-database verification** — assertions A–G executed against an ephemeral
PostgreSQL — and this environment cannot run them (Linux, no Windows, no
Postgres; the `.ps1` wrappers boot a Windows-only local cluster).
**Decision (user call, 2026-10-22):** keep all three as-is and record a narrow
D1 exemption in [REFACTOR_PLAN.md](../REFACTOR_PLAN.md) §4 instead of splitting.
**Why untestable-here code stays whole:** every split so far was gated by a
green suite — that gate is what makes D1 safe. Splitting code nobody can
execute here would replace one *known*-size file, readable end-to-end, with
several smaller files whose behaviour cannot be verified until someone with
Windows + PostgreSQL runs them; a refactor with no gate is exactly what the
"no behaviour changes" ground rule forbids. The 459 lines are a known cost; an
unverifiable split is an unknown one. **Consequences:** the exemption names
exactly these three Windows/real-DB paths — every other script (e.g.
`scripts/run_daily.py`, 266) stays subject to D1's caps, and the line counts
are recorded so drift stays visible. If a Windows/Postgres environment ever
runs this suite (e.g. via CI), the exemption should be revisited and the split
re-proposed — documented, not forgotten.

## 11. Full-corpus harvest: ZIP shards, headed browser, human-solved CAPTCHA

**Context (2026-10-23).** One Zillow search cannot return NYC's 22,756 active
listings — pagination stops around 820 rows. Separately, Zillow now answers
`/<slug>/` pages with HTTP 403 **and a complete `__NEXT_DATA__` payload**; the
old `403 => abort` rule killed every full run in three seconds
([evidence](../jobs/harvest-probe/evidence/findings.md), screenshot included).

**Decision.**
1. Shard by ZIP (`config/nyc_zips.csv`, 177 residential MODZCTAs), using the
   robots-allowed `/<borough>-ny-<zip>/` + `/<slug>/N_p/` shapes. No
   `?searchQueryState=`, no filter paths.
2. Detect a block by **payload absence**, not status: if `searchPageState`
   (or the detail `gdpClientCache`) parses, the page is usable.
3. When the payload is genuinely absent and PerimeterX is on screen, the run
   **pauses** in a headed Chromium window, a human solves it, and the same
   cookies continue. No solver, no bypass. `browser.py` owns this; the legacy
   `http.looks_like_block()` is untouched so its 403 test still pins the
   curl_cffi path.

**Why a browser instead of curl_cffi.** Manual solving requires a visible,
stateful session whose clearance cookie is bound to one residential exit IP;
`build_browser_proxy()` therefore maps a named session to a sticky DataImpulse
port (10000+), and the browser profile persists cookies across restarts.

**Consequences.** The harvest is resumable (`harvest_state.json`), writes the
same four stage-1 artifacts, and `src.clean` consumes it unchanged. Detail
enrichment is a separate, slower pass (`--details motivated|all`); search cards
already carry price, price change, DOM, type, beds/baths/sqft and lat/long.

## 12. Clean-stage market guard is opt-in (`--sanitize`)

**Context (2026-10-24).** The 22,577-row harvest carried three kinds of rows
that are real scrape output but not market signal: 147 cards with
`price_current = 0` (auction / "contact for price"), 113 out-of-state rows
Zillow pads ZIP pages with, and 10 rows where a duplicated digit group made
`price_previous` 10–100× the current price. The last group produced 7 fake
`High` scores because the rule only looks at the drop percentage.

**Decision.** `derive.sanitize()` drops the first two groups and nulls
`price_previous` on the third (keeping the row). It runs only when
`--sanitize` is passed, and `scripts/run_daily.py` always passes it. The
default path is unchanged, so the fixture-pinned raw→tabular contract and its
counts stay valid.

**Why opt-in rather than unconditional.** `tests/fixtures/sample_raw.jsonl`
deliberately contains two NJ rows to pin `state` pass-through; an unconditional
drop would have silently changed the contract every consumer tests against.
The flag makes the change explicit in the process log, which records the three
counts on every run.

**Consequences.** 22,577 raw rows → 22,317 analysed rows; High 1,855 → 1,844.
The guard lives in stage 2 only — the raw JSONL keeps every row, so raising or
lowering the thresholds later costs one re-clean, not a re-scrape.
