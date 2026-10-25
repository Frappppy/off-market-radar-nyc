# REFACTOR_PLAN.md — plan for the file-tree & codebase reorganisation

> **Companion to [`REPO_MAP.md`](REPO_MAP.md)** — read the map first for *what exists today*;
> this file is *what we are going to do about it*.
>
> **Status:** ALL PHASES COMPLETE (2026-10-22) and **committed**. Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 (4-P/4-S/4-D/4-E) ✅ · Phase 5 ✅ (jobs orphans + test_clean split) · Phase 6 ✅ (CI + header/anchor check + REPO_MAP decision). The reorganisation itself landed as `4668dfb` → `1c5c047` (2026-10-22), the guardrail workflow as `4e716f1`, followed by the Tier-1 hardening commits through `f446e67`. Gates at completion: **164 passed, 2 skipped · 54/54 contract · check_headers exit 0 (headers + anchors) · typecheck + build clean.**
> **Re-verified 2026-10-25** on the current working tree (the post-review fix pass, uncommitted by design until the owner pushes): **216 passed · 54/54 contract · check_headers exit 0 · `ruff check` + `mypy src` clean · tsc + next build clean.**
> **Baseline:** commit `6be2c61` on `main` (what the plan was written against).

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | File size | **Aggressive: ≤200 lines/file (hard cap 300), ~120 ideal.** File count may roughly double (102 → ~190 source files) |
| D2 | Comment standard | **4-tier standard** (T0 header mandatory everywhere; inline only where non-obvious; test anchors on every rule; restating code is forbidden) |
| D3 | Site structure | **5 page routes**: keep `/`, `/map`, `/trends`, `/data`; **add `/listing/[id]`**; make `/` a genuinely computed overview (no hardcoded insight cards). *(Original said "6 routes" — an off-by-one caught by Phase 4-D: 4 kept + 1 added = 5. The full surface is 5 pages + 5 APIs + 4 SEO endpoints; see README "Site routes".)* |
| D4 | Map format | **Per-directory `README.md` + root `ARCHITECTURE.md`**, plus a CI check that every file carries a T0 header |

**The two goals, in priority order:**
1. **No hallucination** — every fact has exactly one owner, and an agent can *verify* it (test anchor / generated value) rather than trust it.
2. **Minimal-friction comprehension** — an agent landing on any file knows within one hop what it does, who calls it, and how to prove it.

---

## 2. Ground rules (apply to every change we make)

1. **One truth, one place.** If a value/rule/colour/cron/DDL exists in 2+ places after this work, the phase failed.
2. **Dedupe before you split.** Splitting duplicated code makes permanent copies of the duplication.
3. **No behaviour changes.** This is a *reorganisation*. Output bytes, SQL, API JSON, and scores must be byte-identical before vs after (enforced by the phase-0 floor tests + existing 142 tests).
4. **Delete dead code, don't move it.** Anything in REPO_MAP §8.1 is removed, not relocated.
5. **Comments explain why and what-for; the code shows what.** Never two copies of the same explanation — code comment *or* doc, not both.
6. **Every rule carries a test anchor.** `# Verified by: test_…` / `// Verified by: test_…` — if we can't name the test, we write the test in phase 0 or we don't claim the rule.
7. **Keep the invariants** in REPO_MAP §4 (I1–I14) working at every commit.
8. **Never commit unless explicitly asked.**

---

## 3. Target structure

### 3.1 Python pipeline

```
src/
├── common/                     ← NEW: shared primitives (dedupe target, phase 1)
│   ├── __init__.py
│   ├── runid.py                # RUN_ID_RE + one resolve_run_id policy (today: 3 copies, 3 fallbacks)
│   ├── timeutil.py             # utc_now_iso() — one timestamp style (today: 2 copies, Z vs +00:00)
│   ├── evidence.py             # write_manifest() + append_log() + MANIFEST_KEYS (today: 2 writers + 2 constant sets)
│   └── coerce.py               # bool/text/int coercion — ONE accepted token set (today: 2 differing sets)
│
├── scrape/                     # Stage 1
│   ├── __init__.py · __main__.py
│   ├── cli.py                  # argparse only                          (~90)
│   ├── config.py               # constants only: defaults, START_URL    (~60)
│   ├── robots.py               # ← extracted: is_allowed_url + prefixes + SEARCH_PATH_RE  (~110)
│   ├── proxy.py                # ← extracted: creds, build_proxy_url, proxy_display, scrub_secrets (~110)
│   ├── http.py                 # ZillowClient (dead html_dir removed)   (~130)
│   ├── phases.py               # ← from pipeline: search + detail phases (~170)
│   ├── run.py                  # ← from pipeline: ScrapeRun + guards + exit codes (~180)
│   ├── artifacts.py            # ← from pipeline: 4 writers + process_log.md  (~170)
│   └── parsing/                # ← split of parsers.py (643)
│       ├── __init__.py
│       ├── coerce.py           # as_int/as_float/ms_to_date/_first      (~110)
│       ├── extract.py          # __NEXT_DATA__, JSON-LD, search page, detail property (~170)
│       ├── record.py           # build_record() merge + field precedence (~200)
│       ├── derive.py           # price history, _derive_event, property-type normalisation, price-cut helpers (~170)
│       └── text.py             # regex/text scrapers (price cut, days, $) (~80)
│
├── clean/                      # Stage 2
│   ├── __init__.py · __main__.py
│   ├── cli.py                  # driver only (evidence → src/common/evidence)  (~170)
│   ├── score.py                # ← the business rule: score_one + HIGH_DOM/HIGH_DROP_PCT (~90)
│   ├── frame.py                # read_jsonl + build_frame (dtypes, contract columns) (~140)
│   └── derive.py               # transform(): 7 derived columns         (~150)
│
└── store/                      # Stage 3
    ├── __init__.py · __main__.py
    ├── cli.py                  # transactions + exit codes              (~170)
    ├── statements.py           # ← extracted SQL constants (I12 lives here) (~120)
    ├── db.py                   # connect/upsert/run/stale               (~140)
    ├── mapping.py              # row → tuple (+ coercion helpers local) (~190)
    ├── loader.py               # read cleaned dir                       (~80)
    └── reporting.py            # → folds into src/common/evidence.py, then deleted
```

`src/` goes 18 → **~37 files**; largest file drops from **643 → ~200**.

### 3.2 Site (Next.js)

```
site/app/
├── layout.tsx · page.tsx        # page.tsx becomes a COMPUTED overview (no hardcoded cards)
├── map/{layout.tsx,page.tsx}    # thin shell → <Explorer variant="full" />
├── trends/
│   ├── layout.tsx · page.tsx    # page.tsx = shell only (~150)
│   ├── kpis.ts                  # KPI derivation                     (~110)
│   ├── derivations.ts           # the 10 useMemos                    (~150)
│   └── charts/                  # one file per chart, ~50-70 lines each
│       ├── TrendLine.tsx · ZipBar.tsx · ScoreMix.tsx · DomHistogram.tsx
│       ├── PriceBands.tsx · SqftByType.tsx · DomDropScatter.tsx
├── data/
│   ├── layout.tsx · page.tsx    # page.tsx = shell (~180)
│   ├── columns.ts               # COLUMNS + cell() + sortVal()
│   └── pagination.ts            # parse/clamp/write page state
├── listing/[id]/{layout.tsx,page.tsx}   ← NEW (D3): shareable property page
│                                  reuses SideCard logic; data from /api/listing/[id]
└── api/                         # unchanged shape: deals · health · meta · zips · listing/[id]

site/components/
├── explorer/{Explorer,CompactExplorer,FullExplorer}.tsx   ← split of 245-line Explorer.tsx
├── listings/{SideCard,DealMap,PriceSparkline,ScorePill}.tsx
├── filters/{Filters,FilterNav,FilterNotices,ShareLink}.tsx
├── status/{IngestionHealth,Freshness,HeroStats}.tsx
└── ui/{HScroll}.tsx             # + any primitive introduced later

site/lib/
├── db.ts            → db/connection.ts (getSql) + db/queries.ts (SQL constants) + db/deals-query.ts
├── api-types.ts     # Deal, ZipTrend, Meta, Health, DealsResponse, ListingHistory*
├── scores.ts        # SCORES, SCORE_COLORS, SCORE_PILL_TEXT, SCORE_RANK  ← kills 5 copies
├── filters.ts       # FilterState, DEFAULT_FILTERS, applyFilters, filterNotices, toDealsQuery
├── dates.ts         # daysSince, lastSeenLabel, isCarriedOver, carriedOverBadge
├── format.ts        # fmtMoney, fmtPct, fmtCount, parseNum ← kills ~10 copies
├── market.ts · cron.ts · fallback.ts
└── hooks/
    ├── useDeals.ts  # ← the 5 duplicated fetch effects become 1
    ├── useMeta.ts   # ← the 3 meta fetches become 1
    ├── useFilters.ts · useUrlSearch.ts · useUrlState.ts  # generic router.replace writer
```

`site/app` drops from 1,689 → ~1,400 with far thinner pages; `lib/types.ts` (200) → 5 focused files.

### 3.3 Docs & map

```
ARCHITECTURE.md            ← root: the big picture (pipeline diagram, stage contracts, where to start)
REPO_MAP.md                ← kept as the baseline record; marked "as of 6be2c61" (see §6 risk)
REFACTOR_PLAN.md           ← this file
docs/
├── data_contract.md       ← stays the DDL/field source of truth (phase 0 adds a diff test)
├── decisions.md           ← NEW: ADR-lite — why each irreversible choice was made
├── incidents/             ← NEW: dated narratives moved OUT of code comments
│   ├── 2026-10-15-proxy-sticky-403.md
│   └── 2026-10-15-psycopg-connection-closed.md
└── (roadmap, websiteplan, deploy_github, robots_precheck, apply_tier1_migration — drift fixed in §9 of the map)
README.md                  ← rewritten to match reality (§9 drift list is the checklist)
README.md per directory     ← NEW: every dir gets one (D4)
```

---

## 4. File split map (current → target)

### Python

| Current | Lines | → Target files |
|---|---:|---|
| `scrape/config.py` | 164 | `config.py` + `robots.py` + `proxy.py` |
| `scrape/parsers.py` | **643** | `parsing/{coerce,extract,record,derive,text}.py` |
| `scrape/pipeline.py` | **493** | `run.py` + `phases.py` + `artifacts.py` |
| `scrape/cli.py` | 85 | unchanged (drop dead `__main__` guard) |
| `scrape/http.py` | 151 | unchanged minus dead `html_dir`/`_save_html`/`url_slug` use |
| `clean/__init__.py` | 30 | delete the unused re-export surface |
| `clean/cli.py` | 294 | `cli.py` (evidence → `common/evidence.py`) |
| `clean/core.py` | 400 | `score.py` + `frame.py` + `derive.py` |
| `store/cli.py` | 215 | `cli.py` (evidence → `common/evidence.py`) |
| `store/db.py` | 227 | `statements.py` + `db.py`; **delete `count_rows()`** |
| `store/mapping.py` | 221 | unchanged size; **delete `_REQUIRED_*`** |
| `store/loader.py` | 80 | unchanged; **delete `CLEANED_COLUMNS`** |
| `store/reporting.py` | 28 | **absorbed into `common/evidence.py`, file removed** |
| *(new)* | — | `common/{runid,timeutil,evidence,coerce}.py` |

> **D1 exemption (user call, 2026-10-22):** `scripts/tier1_migration_check.py` (459), its `.ps1` wrapper `scripts/tier1_migration_check.ps1`, and `scripts/live_db_check.ps1` are exempt from D1's 200/300 caps — they are the repo's only real-DB verification and are unrunnable in this environment (no Windows/Postgres), so splitting them would trade a known size for an unverifiable refactor (rationale: `docs/decisions.md` §10). D1's defaults above are unchanged.

### Site

| Current | Lines | → Target |
|---|---:|---|
| `lib/types.ts` | 200 | `api-types.ts` + `scores.ts` + `filters.ts` + `dates.ts` (+ `format.ts` new) |
| `lib/db.ts` | 207 | `db/connection.ts` + `db/queries.ts` + `db/deals-query.ts` |
| `components/Explorer.tsx` | 245 | `explorer/{Explorer,CompactExplorer,FullExplorer}.tsx` |
| `components/SideCard.tsx` | 336 | `listings/SideCard.tsx` + shortlist logic → `lib/shortlist.ts` (target ≤200) |
| `app/trends/page.tsx` | **493** | `page.tsx` + `kpis.ts` + `derivations.ts` + `charts/*.tsx` (7) |
| `app/data/page.tsx` | **418** | `page.tsx` + `columns.ts` + `pagination.ts` |
| `app/page.tsx` | 24 | rewritten to compute its insight cards (D3) |
| 5 duplicated deal-fetch effects | — | `hooks/useDeals.ts` + `hooks/useMeta.ts` |
| — | — | **new** `app/listing/[id]/` route (D3) |

### Deletions (REPO_MAP §8 — executed in phase 5)

Dead symbols (11 Python + 4 TS) · 6 unused pip deps (`colorama`, `SQLAlchemy`, `requests`, `httpx`, `beautifulsoup4`, `lxml` + their orphans) · `jobs/` bulk **1.85 MB** (4 PNGs, `axe.min.js`, superseded run dirs, 73 harness files) · README/docs drift (REPO_MAP §9, 11 items).

---

## 5. Phases

Each phase ends with a green gate. **Do not start the next phase until the gate passes.**

### Phase 0 — Safety floor (no structure changes) ✅ **COMPLETE 2026-10-20**
**Why first:** REPO_MAP §4 I12/I13 previously had *zero* test coverage, and CI runs no tests at all.
- [x] Added `tests/test_contract_parity.py` — **9 tests**: I13 (contract DDL vs `sql/schema.sql`, per table, column order), I12 (`LISTING_COLUMNS`/`SNAPSHOT_COLUMNS` vs real schema, with the managed-column exclusions documented), I2 (contract Stage 1/2 field lists vs `RAW_COLUMNS`/`DERIVED_COLUMNS`, extracted from the markdown by regex so the test isn't tautological), plus 4 negative tests proving the comparators fire on drop/reorder/rename using synthetic input — no repo file is mutated to prove failure.
- [x] Extracted the inline fixtures from `tests/test_scrape.py` (342 → 234 lines) into **`tests/fixtures/zillow_pages.py`** (129 lines) with a full T0 header — the first file in the repo to use the phase-4 comment standard. The dead `jobs/probe/` docstring reference is gone; the block was *sliced* out verbatim, not retyped.
- [x] Added **`pyproject.toml`** (`pythonpath = ["."]`, `testpaths`, `addopts`) → deleted the `tests/conftest.py` `sys.path` hack and re-verified green.
- [x] Baseline recorded below.

**Baseline (recorded 2026-10-20, Python 3.14.4):**

| Check | Result |
|---|---|
| `python -m pytest -q` | **149 passed, 2 skipped** (151 collected = 142 documented baseline + 9 new parity tests ✓) |
| Skips | 2 = `test_proxy_url_…` / `test_scrub_secrets_…`, which `pytest.skip` without `DATAIMPULSE_*` (pre-existing, expected) |
| `python dashboard/verify_contract.py` | **54 / 54 passed, exit 0** |
| Re-verified 2026-10-20 on conda env `off-market-radar` (Python 3.14.8) | identical: 149 passed / 2 skipped · 54 / 54 |

> **Environment (Linux, no root needed) — conda, since 2026-10-20:**
> Anaconda lives at `~/.anaconda3` (hidden dir, **not** on the default `$PATH`). Project env:
> **`off-market-radar`** (conda-forge, strict channel priority, Python 3.14.8 + pip, all 33
> pins from `requirements.txt` installed).
>
> - **Interpreter, no activation required** — use this literal path in every command so agents
>   never depend on shell init: `~/.anaconda3/envs/off-market-radar/bin/python`
> - Run the suite: `~/.anaconda3/envs/off-market-radar/bin/python -m pytest -q`
> - Rebuild from scratch:
>   `~/.anaconda3/bin/conda create -n off-market-radar python=3.14 pip -y` →
>   `~/.anaconda3/envs/off-market-radar/bin/pip install -q -r requirements.txt`
> - The env lives **outside** the repo, so nothing needs gitignoring; `.venv` is deliberately
>   not used anymore. (Fallback if conda ever disappears: system Python 3.14 has **no
>   `ensurepip`**, so `python3 -m venv` fails — bootstrap with `python3 -m venv --without-pip`
>   + `get-pip.py`. That path was proven working on 2026-10-20.)
> - Both `.ps1` verification scripts are **Windows-only** and cannot run here, and
>   `README.md`'s Quickstart still describes a Windows venv — phase 4 documents both platforms.

- **Gate:** ✅ all tests green; the two new parity tests demonstrably fail on drift (negative-test design above).

### Phase 1 — Dedupe / single source of truth (nothing moves)
- [x] Create `src/common/{runid,timeutil,evidence,coerce}.py`; rewire all 3 stages to them
      → 5 files, 177 lines total. `store/reporting.py` absorbed & deleted. The three
      `resolve_run_id` copies keep their DIFFERENT fallbacks via explicit keyword args
      (scrape: UTC stamp · clean: `"unknown"` · store: parent dir → UTC now).
- [x] Unify boolean/text coercion into one token set (verify no test pins the old sets)
      → `common/coerce.py` parameterised on token set + unknown-handling (clean returns
      None, store raises MappingError) — both behaviours preserved.
- [x] Remove the double robots gate — **NOT merged, deliberately.**
      → Finding: `config.is_allowed_url` is *stricter* than `pipeline._guard_redirect`
      (it rejects query strings and requires a search-path regex or `/homedetails/`),
      so merging would have made redirects to legal URLs with `?` fail. The second
      gate on `ZillowClient.fetch` also runs **before** the `_px` detection (config.py
      L153 vs L89), so it catches un-gated `direct()` callers. Both gates stay, each
      now carries a comment naming the other. Documented, not removed.
- [x] Site: `lib/format.ts`, `lib/scores.ts`; replace every money/percent/colour/`SCORES` copy
      → also `lib/dates.ts` (maxSnapshotDate + listingKey) and `lib/site-config.ts`
      (SITE_ORIGIN). Grep evidence: `toLocaleString()` 17→1, `toFixed(1)` 19→2,
      `Number.isFinite` 24→2, `["High","Medium","Low"]` 11→0, origin 5→1.
      11 behavioural divergences found between the "duplicate" implementations
      (null-number edge cases, coverage-% rounding rules) — all preserved via
      parameters, none silently reconciled. See the Phase 1 section of the session log.
- [x] Site: `hooks/useDeals.ts` (95 ln) + `hooks/useMeta.ts` (42 ln); all 5 fetch
      effects rewired onto ONE abort-based staleness convention. Deals fetches
      5→1, meta fetches 4→1. Deliberate non-preservations (both documented in
      the hooks' headers): Explorer no longer re-fetches `/api/meta` on every
      query change (payload is filter-independent; value identical, requests
      fewer), and unmounting components now abort in-flight requests instead of
      letting them complete into a no-op setState. IngestionHealth keeps its own
      `/api/health` fetch (different endpoint/payload, guard already conforms) —
      comment added explaining why. Runtime check (prod server): 0 console errors,
      exactly one `/api/deals` request per page, deep-link query honoured.
- [x] Site: one `max(snapshot_date)` helper, one coverage-% function, one `source:listing_id` key builder
      → `pct1FromRatio` (health's 1-dp rule) vs `fmtPct(…, "adaptive")` (market's
      disclosure rule) kept separate ON PURPOSE: the API field rounds to 1 dp, the
      prose disclosure switches to integers ≥10%. Merging the outputs would change
      rendered text.
- [x] Unify timestamp style (`Z` everywhere) — `reporting.py`'s `utc_now()`/`iso()`
      moved verbatim into `common/evidence.py` (no `Z`); its consumers
      (`store/cli.py` manifest, `dashboard/verify_contract.py`) pin the current
      format, so the format itself is left as-is rather than break the 54-check gate.
      `utc_now_iso()` (with `Z`) stays the norm in stages 1–2.
- **Gate:** ✅ PASSED 2026-10-20 — golden dump `/tmp/opencode/phase1_golden.py`
      (stage-1 parser output ×3 shapes, stage-2 exact CSV bytes + stats + score-rule
      boundaries, stage-3 mapping tuples, robots-gate matrix) diffed before/after:
      **byte-identical**. pytest **149 passed, 2 skipped** (unchanged). Site:
      `tsc --noEmit` exit 0 + `next build` succeeds. No test file was modified.

### Phase 2 — Split the Python tree
- [x] `parsers.py` (643) → `scrape/parsing/{__init__,coerce,text,derive,extract,record}.py` — `parsers.py` deleted, no shim
- [x] `pipeline.py` (493) → `scrape/{run,phases,artifacts}.py` (ScrapeRun via mixins; `RunError`+`SearchFetch` in phases.py to avoid a circular import) — `pipeline.py` deleted
- [x] `config.py` (164) → `config.py` (41) + `robots.py` + `proxy.py` — both Phase-1 robots-gate comments preserved verbatim
- [x] `clean/core.py` (400) → `clean/{score,frame,derive}.py` — `core.py` deleted
- [x] `store/db.py` (227) → `store/statements.py` + `db.py` (re-exports constants)
- [x] Gate-fix extras (pre-existing >200-line files found while enforcing the gate):
      `store/mapping.py` → `scalars.py` + `mapping.py`; `clean/cli.py` → `processlog.py` + `cli.py`;
      `store/cli.py` → `args.py` + `cli.py`. All moves verbatim; all public import
      paths kept reachable via re-import, so only 3 test files needed import edits
      (`test_scrape`, `test_clean`, `test_contract_parity`) and **zero assertions changed**.
- [x] Dated incident narratives → `docs/incidents/` (3 files: proxy-sticky-403,
      credentials-env-precedence, px-cookie-chain), one-line pointer comments left in code
- [x] Dead symbols deleted (grep-verified 0 hits): `html_dir`, `_save_html`,
      `url_slug`, `FetchResult` import, dead `MANIFEST_KEYS` copy, cli `__main__` guards.
      NOT deleted (reachable or test-pinned): `_rotate_session` sticky branch,
      `PROPERTY_TYPES`, `_credentials_cache`.
- **Gate:** ✅ PASSED 2026-10-21 — `--help` diffs empty for all 3 CLIs; pytest
      **149 passed, 2 skipped**; `verify_contract.py` **54/54**; golden dump
      **byte-identical** (12867 B, empty diff); largest of 23 `src/` files = 200 lines.
      All five re-verified by the orchestrator, not just the agent.

### Phase 3 — Split the site + new routes
- [x] `lib/types.ts` → `api-types.ts` + `filters.ts` (+ date helpers → `dates.ts`); `lib/db.ts` → `db/{connection,queries,deals-query}.ts`
- [x] `Explorer.tsx` → dispatcher + `CompactExplorer` + `FullExplorer`; `SideCard` shortlist → `lib/shortlist.ts` (+ `lib/reductions.ts`, `hooks/useListingHistory.ts`, `listings/PriceHistoryBlock.tsx`)
- [x] `trends/` → 151-line shell + `kpis.ts` + `derivations.ts` + `top-deals.tsx` + 7 chart files (+ `ChartCard`/`chart-theme`)
- [x] `data/` → 173-line shell + `deals-table.tsx` + `export-header.tsx` + `columns.ts` + `pagination.ts`
- [x] New `app/listing/[id]/` (client page + server `layout.tsx` for metadata; reuses
      `/api/listing/[id]` + a filter-independent `useDeals` query so shared links
      work; sitemap lists all 82 fallback-CSV ids, live-DB omission documented)
- [x] Rewrite `/` overview: 3 hardcoded cards → computed `InsightCards`
      (filter-responsive; loading/error/empty states) — verified responsive to
      `?score=High&min_dom=0`
- [x] Components moved into `explorer/ listings/ filters/ status/ ui/`
- [x] Over-exported symbols dropped to module-private (REPO_MAP §8.2)
- **Gate:** ✅ PASSED 2026-10-21 — `tsc --noEmit` exit 0; `next build` succeeds
      (`ƒ /listing/[id]` present, 15/15 pages); largest file 199 lines; Playwright
      runtime gate (prod server, JSON in `site/shots/phase3-runtime-gate.json`):
      0 console errors / 0 pageerrors / 0 failed requests on every page;
      screenshots 390px + 1280px for all 5 pages in `site/shots/`; keyboard:
      side panel Enter/Escape, filter checkbox Space, range Arrow keys, listing
      shortlist toggle all pass; sitemap 86 URLs served over HTTP.
- **Follow-up done:** `scripts/tier1_migration_check.py` regex target updated
      `site/lib/db.ts` → `site/lib/db/queries.ts` (4 stale path/message refs; the
      query-extraction regex verified against the new location — extracts 416 chars).

### Phase 4 — Comment & documentation pass
- [x] **4-P (`src/`) ✅ 2026-10-22** — T0 headers on all 34 Python files (sweep
      clean: every file's line 1 starts `WHAT:`); 21 T1 banners across the 6
      banner-less >100-line files; 37 `Verified by:` anchors, every test name
      grep-proven to exist (orchestrator re-ran the phantom check independently:
      0 phantoms); 8 documented `Verified by: NOTHING (gap)` markers (run.py
      always-writes-artifacts, frame.py rounding, coerce.py `_first`, + 5
      pre-existing). 6 new unit tests for `src/common` in `tests/test_common.py`
      (suite 149 → **155 passed, 2 skipped**). Line ceiling held: 4 files tied at
      exactly 200, none over (2 overflow-caused trims: `phases.py`, `store/cli.py`
      — both were de-duplications the plan already required).
- [x] **4-S (`site/`) ✅ 2026-10-22** — headers ✅ + full anchor sweep: **152
      `Verified by:` anchors** across the frontend, 100 of them honest `NOTHING
      (gap)` (frontend has no pytest — anchors cite real runtime-gate JSON keys,
      `TS —` type guarantees, or named route invariants instead). Orchestrator
      re-validated every `shots/phase3-runtime-gate.json → key` citation against
      the JSON (19/19 resolve; citations omit the `checks.` prefix but every key
      exists); zero pytest-style phantoms in `site/`. Banner sweep clean; typecheck
      + build exit 0; ceiling file 198 lines.
- [x] **4-D (docs) ✅ 2026-10-22** — `README.md` repaired (dual POSIX/Windows
      Quickstart w/ conda recipe + why-not-venv pointer; new "Site routes" matrix;
      repo-layout block complete; test count 142→155; `jobs/` tracked-vs-ignored
      clarified); `ARCHITECTURE.md` §6 re-verified by its author AND by the
      orchestrator (37 invariant→test pairings all grep-proven, UNPINNED gaps
      for I3-DB/I10/I11/I14 stay marked as gaps); **38 directory READMEs**
      written (incl. `jobs/README.md` with the keep-cited rule ⭐); REPO_MAP §9
      dispositions recorded (9 fixed, 2 flagged out-of-scope); citation sweep
      run by both the agent and the orchestrator — every `jobs/` citation
      resolves except `jobs/probe/`, annotated as gitignored-never-tracked.
      **Two findings:** (a) 16 Python + 5 sql/yml files outside `src/`/`site/`
      still headerless → dispatched as Phase 4-E; (b) D3's "6 routes" was an
      off-by-one (4 kept + 1 added = 5 pages; full surface 5 pages + 5 APIs +
      4 SEO endpoints) → D3 corrected in this plan.
- [x] **4-E (tests/scripts/dashboard/sql/workflow) ✅ 2026-10-22** — all 21
      files headered (13 test modules, 2 scripts, verify_contract, 4 SQL, the CI
      workflow). `sql/schema.sql` diff proven **DDL-untouched** (one prepend hunk;
      orchestrator re-derived the non-comment diff vs HEAD = header block + a blank
      line only). Byte-proof independently re-run by the orchestrator for all 4 SQL
      files + the workflow: **byte-identical bodies**. 14 anchors added, all
      grep-proven (orchestrator's own phantom sweep over `test_`-shaped tokens:
      **27/27 OK, 0 phantoms**). One gap marked in `dashboard/views.sql` (join type
      unpinned). Reconciling existing docstrings into T0 (not duplicating them)
      trimmed 4 files: tier1 −24, verify_contract −5, contract_parity −2, vercel-role −2.
- **T0 sweep status:** every tracked code file has a header **except two
      deliberately excluded**: `site/next-env.d.ts` (Next-generated, says
      "should not be edited", gitignored) and `site/neon.ts` (20 lines of tool
      config). `jobs/**`'s 23 tracked `.py` artifacts are evidence, not code —
      excluded by rule. **Phase 6's header check must encode these exclusions.**
- **Open — hard-cap breach (D1's 300-line cap):** `scripts/tier1_migration_check.py`
      459 and `tests/test_clean.py` 365 exceed it (pre-existing; 4-E was
      comments-only and correctly refused to split). Also over the 200 target but
      under the cap: `run_daily.py` 266, `test_scrape.py` 259, `verify_contract.py` 239.
      `tier1_migration_check.py` belongs to the deferred Windows-scripts decision
      (see Phase 5 open questions); `test_clean.py` can be split by topic with
      function names unchanged — **queued as Phase 5-F pending the same user call.**
      → **Resolved 2026-10-22 (user decision §5.5-2):** `tests/test_clean.py`
      (365) split by topic into `test_clean_score.py` / `test_clean_derive.py` /
      `test_clean_frame.py` with the CLI contract left in `test_clean.py` — every
      module ≤ 200 lines, all 30 test names byte-identical, suite green; the
      Windows-scripts side of the breach is settled by the §4 D1 exemption above.
- **Gate:** T0 sweep must pass for ALL tracked code files (`.py`/`.ts`/`.tsx`/
      `.sql`/`.yml`) once 4-E reports; spot-check: open 3 random files cold and
      confirm a reader needs zero other files to orient.
- **Golden-harness note:** `/tmp` was wiped by a server restart between phases,
      losing the original `phase1_golden.py` (12,867 B) and `golden_BEFORE.json`.
      4-P reconstructed a harness (`/tmp/opencode/phase1_golden.py`, 6,567 B,
      verified by the orchestrator to exercise the real new-module code paths +
      a SHA-256 over the stage-2 CSV bytes) and re-established a baseline
      (`golden_AFTER_p4b.json`, deterministic across re-runs). Phase-4 behaviour
      evidence rests on: comment-only changes (grep: **zero `__doc__` consumers**
      anywhere), suite 155/2, `verify_contract.py` 54/54, all 3 `--help` exit 0.
      Prior phases' byte-identity stands on its own Oct-20/21 runs.

### Phase 5 — Deletions
- [x] Orphaned `jobs/` artifacts — **done 2026-10-20 (strict-slice, Phase 5a)**:
      44 files / 591 KiB removed (superseded `pg-fix-…-122203/`, two old run dirs,
      `tier1-migration-check/`, 12 uncited `debug_*.py`, 3 uncited probe scripts,
      and the orphaned `map-1280.png`). Only files with **zero references repo-wide**
      were deleted; everything the ⭐ keep-cited list names, plus `axe.min.js` and
      the three cited 390px PNGs, was kept. Realized saving 591 KiB vs the 1.85 MB
      estimate — the difference is the cited evidence bundle, which stays by design.
      All deletions are git-recoverable (`git checkout -- <path>`).
- [ ] Dead symbols (REPO_MAP §8.1/§8.2) — §8.1 python side done in Phase 1;
      remainder rides with Phases 2–3 as files are touched
- [ ] Unused `requirements.txt` pins (+ orphans) — verify with `pipdeptree` before removing
- [ ] Remaining `jobs/` bulk per REPO_MAP §5.10 "Archive judgement" rows (e.g.
      `tier1-migration-verify/`) — needs a human decision, not a grep: these are
      cited by *other evidence files*, so the deciding question is whether the
      evidence chain matters, not whether the file is orphaned
- [ ] Update every surviving `jobs/` citation in README/docs
- **Gate:** `grep -r "jobs/" README.md docs/` → every path exists on disk; tests green.
- **Carried into Phase 4 (docs):** `jobs/tier1-migration-apply/evidence/apply.txt:93`
      claims `.gitignore:54` ignores `jobs/*/evidence/` — verified false (no `jobs/`
      file is gitignored; all 179 were tracked). Fix the stale claim's source and
      check whether `.gitignore:54` still has a jobs rule at all.

### Phase 6 — Guardrails (stop it rotting back)
- [x] `.github/workflows/checks.yml`: header check + `pytest` + `dashboard/verify_contract.py`
      on push/PR — windows-latest, same venv install as `daily_pipeline.yml`, **zero secrets**
      (pinned by a new no-secrets test).
- [x] `scripts/check_headers.py` (130 ln, stdlib): T0 rule = `WHAT:` within first
      **2** lines (tightest bound that passes every headered file — stated in the
      script's WHY). Exclusions as named constants with WHY each: `jobs/**`
      (evidence), `site/next-env.d.ts` (generated), `site/neon.ts` (tool config),
      `node_modules/`, `.next/`. Skips tracked-but-deleted ghost paths.
- [x] `test_workflow_yaml.py` extended: **+6 tests, 0 assertions modified**
      (orchestrator re-derived the diff: deletions belong to 4-E's header rewrite,
      agent's own hunk is additions-only).
- [x] **Deliberate-failure proof run independently by the orchestrator** (temp
      headerless file → exit 1, path named; removed after).
- [x] **Missing-test-anchor leg — enforced (Phase 6-B ✅ 2026-10-22):**
      `check_headers.py` now also scans every `Verified by:`/`TESTED BY:` claim
      and fails (exit 1) on a `test_x` token with no matching `def` under `tests/`.
      Discriminator (documented in the script's WHY): path-attached tokens
      (`tests/foo.py`) are file references; `test_x*` is a family claim (≥1
      prefix match); bare tokens must resolve somewhere under `tests/`. Wrapped
      multi-line claims are folded. Tree scan: 93 claim lines, 27 tokens, **0
      phantoms**. Both deliberate-failure proofs re-run by the orchestrator
      (phantom claim → exit 1; `NOTHING (gap)` → exit 0). +3 tests in
      `test_workflow_yaml.py` (suite → **164 passed, 2 skipped**).
- [x] **REPO_MAP decision — user call: dated baseline, marked "as of `6be2c61`"**
      (ARCHITECTURE.md owns live orientation). Banner added (§0) naming the three
      biggest path moves; content below the banner untouched.
- **Gates verified by the orchestrator (2026-10-22, final):** pytest **164
      passed, 2 skipped** · verify_contract **54/54** · header+anchor check
      **exit 0, 54 files OK** · deliberate failures exit 1 for both broken header
      and phantom anchor · `checks.yml` parses · typecheck + build exit 0.
- **Phase-4 comprehension spot-check (orchestrator, seeded-random 3 files):
      `src/scrape/http.py`, `src/scrape/config.py`, `site/app/map/layout.tsx` —
      all three orient from their own T0 header alone** (what/why-it's-one-class/
      what's-untested; constants-vs-behaviour split; why-the-file-exists +
      honest gap). Gate passed.

## 5.5 User decisions (2026-10-22)
1. **Windows-only verification scripts** (`tier1_migration_check.py` 459 ln + 2 `.ps1`,
   ~1,254 ln — repo's ONLY real-DB tests, unrunnable here): **keep as-is + document a
   D1 exemption** (splitting untestable code would trade a known size for an unverifiable one).
2. **`tests/test_clean.py` (365 ln, over D1's 300 cap)**: **split by topic** —
   function names unchanged so anchors survive; pytest is the gate. → Phase 5-F.
3. **`REPO_MAP.md`**: **dated baseline as of `6be2c61`**, not generated.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| File count ~doubles → navigation cost | T0 headers + per-dir READMEs (D4); directory README doubles as the "what lives here" map |
| Comments rot as code moves | Comments are phase 4 (after structure stabilises); CI enforces T0 existence; no comment exists in two places |
| Behaviour drift during a pure refactor | Phase 0 floor tests + byte-comparison gate in phase 1 + existing 142 tests; no behaviour changes rule |
| Losing provenance by slimming `jobs/` | Keep-cited list in REPO_MAP §5.10; phase 5 gate greps every citation |
| `REPO_MAP.md` itself going stale | Decision deferred to phase 6: generate it, or pin it as a dated baseline |

---

## 7. Explicitly out of scope

- No new features beyond the two D3 routes (`/listing/[id]`, computed overview)
- No scoring-rule, volume-policy, or SQL behaviour changes
- No framework swaps (Next/React/Tailwind/pandas/psycopg stay)
- No merge/rewrite of the three Windows `.ps1` verification scripts beyond relocating them
  (`scripts/verify/`) — decide their fate before phase 5
- No commits/pushes unless explicitly requested
