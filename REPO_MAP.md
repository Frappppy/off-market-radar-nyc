> **⚠️ HISTORICAL BASELINE — not the live map (banner added 2026-10-22).**
> This document is a point-in-time baseline as of commit **`6be2c61`**, retained for
> its analysis: the duplication inventory (§7), the invariants (§4), and the
> documentation-drift findings (§9 — whose dispositions are recorded in its table).
> **`ARCHITECTURE.md` is the live map**; consult that for current orientation. Do not
> treat the file paths below as current — several modules have since moved, the three
> biggest being `src/scrape/parsers.py` → `src/scrape/parsing/`,
> `src/scrape/pipeline.py` → `src/scrape/{run,phases,artifacts}.py`, and
> `site/lib/db.ts` → `site/lib/db/`. Everything below this banner is the unmodified
> baseline record.

# REPO_MAP.md — complete map of this repository

> **Purpose:** a single reference document describing every file, every code unit, and
> how the tree is organised — to be used as the baseline for the planned
> **file-tree reorganisation and dead-code deletion**.
>
> **Baseline:** commit `6be2c61` on `main` · analysed 2026-10-20 · 281 tracked files,
> 31,521 tracked lines.
>
> **How to use it:** before moving/deleting anything, find the file here. Sections 7–9
> are the actionable findings (duplication, dead code, deletion candidates, doc drift).
> Section 4 lists the invariants that must survive the refactor.

---

## 1. Snapshot statistics

| Area | Files | Lines | Role |
|---|---:|---:|---|
| `src/scrape` | 7 | 1,548 | Stage 1 — Zillow scraper |
| `src/clean` | 4 | 730 | Stage 2 — pandas transform + scoring |
| `src/store` | 7 | 788 | Stage 3 — Postgres loader |
| `src/` total | 18 | 3,066 | |
| `scripts/` | 4 | 1,512 | Orchestration + 3 Windows verification scripts |
| `tests/` | 13 | 1,629 | 113 test functions → 142 with parametrisation |
| `site/app/` | 16 | 1,689 | Next.js pages + API routes |
| `site/components/` | 12 | 1,559 | Client components |
| `site/lib/` | 7 | 850 | Server SQL + client hooks + types |
| `site/` config + data | 13 | ~204 | package.json, tsconfig, sample CSV (82 rows) |
| `dashboard/` | 4 | 815 | Power BI: views, DAX, build guide, contract checker |
| `sql/` | 3 | 194 | schema, migration, readonly role |
| `docs/` | 6 | 1,157 | Contract, roadmap, deploy, compliance |
| root + `config/` + `.github/` | 6 | 530 | README, gitignore, requirements, env templates, CI |
| **code + docs subtotal** | **~102** | **~13,200** | excluding lockfile + jobs |
| `jobs/` | 179 | 6,354 (md/txt) | Run evidence + one-off debug harnesses (2.8 MB) |
| `site/package-lock.json` | 1 | 3,139 | Lockfile |

---

## 2. How the system fits together

```
                   scripts/run_daily.py  (orchestrator, UTC run_id = YYYYMMDD-HHMMSS)
                   .github/workflows/daily_pipeline.yml  (cron 0 10 * * *, windows-latest)
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
 python -m src.scrape      python -m src.clean         python -m src.store
 Stage 1 SCRAPE            Stage 2 CLEAN               Stage 3 STORE
 curl_cffi + DataImpulse   pandas + motivation_score   psycopg3 → Neon/Postgres
        │                            │                            │
        ▼                            ▼                            ▼
 jobs/<run_id>/raw/         jobs/<run_id>/cleaned/      jobs/<run_id>/store/
   listings.jsonl             listings_<date>.parquet      manifest.json
   pages_fetched.json         listings_<date>.csv          process_log.md
   manifest.json              manifest.json                      │
   process_log.md             process_log.md                      ▼
        │                                                       Postgres
        │                                        listings · listing_snapshots · pipeline_runs
        │                                                       │
        │                                                       ▼ (views)
        │                                        dashboard/views.sql → Power BI
        │                                        site/lib/db.ts (read-only) → Next.js
        ▼
   docs/data_contract.md  ← the binding contract all four stages are written against
```

**Two consumers of the same DB:** `dashboard/` (Power BI, offline) and `site/` (Next.js,
read-only role `offmarket_reader`).

**Environment/secrets:** real values live in gitignored `config/*.local.env` and
`site/.env.local`; only `config/*.env.example` and `site/.env.example` are tracked.

---

## 3. Annotated file tree

```
off-market-radar-nyc/                     ← repo root (this folder IS the repo root)
│
├── REPO_MAP.md                           ← this document (new, untracked)
├── README.md                        376  pitch, quickstart, deploy mechanics, status log
├── .gitignore                         61  secrets / venv / jobs raw+cleaned / powerbi binaries
├── requirements.txt                   33  pinned Python deps (⚠️ 6 unused — §8.3)
│
├── .github/
│   └── workflows/daily_pipeline.yml   49  ONLY CI workflow: daily scrape→clean→store on Windows
│
├── config/
│   ├── database.env.example            4  template → copy to database.local.env (DATABASE_URL)
│   └── dataimpulse.env.example         7  template → copy to dataimpulse.local.env (DATAIMPULSE_*)
│
├── src/                                ← Python pipeline (namespace pkg: NO src/__init__.py)
│   ├── scrape/  Stage 1 (7 files, 1,548 lines)
│   │   ├── __init__.py                 9  docstring index only
│   │   ├── __main__.py                 3  `python -m src.scrape` → cli.main()
│   │   ├── cli.py                     85  argparse: --pages/--max-details/--out/--delay, 2s floor
│   │   ├── config.py                 164  proxy creds+URL, secret scrubbing, robots URL gate
│   │   ├── http.py                   151  curl_cffi client: pacing, 429/5xx retry, CAPTCHA abort
│   │   ├── parsers.py                643  __NEXT_DATA__/JSON-LD extraction → contract record ⚠️ longest
│   │   └── pipeline.py               493  ScrapeRun: search phase, detail phase, artifact writers
│   │
│   ├── clean/  Stage 2 (4 files, 730 lines)
│   │   ├── __init__.py                30  re-exports (⚠️ none consumed — §8.2)
│   │   ├── __main__.py                 6  `python -m src.clean` → cli.main()
│   │   ├── cli.py                    294  drives clean_file, writes parquet+csv+manifest+log
│   │   └── core.py                   400  read_jsonl / build_frame / transform / score_one
│   │
│   └── store/  Stage 3 (7 files, 788 lines)
│       ├── __init__.py                11  defines StoreError
│       ├── __main__.py                 6  `python -m src.store` → cli.main()
│       ├── cli.py                    215  3 transactions, exit codes 0/1/2, evidence writing
│       ├── db.py                     227  connection, ON CONFLICT upserts, stale marking, redaction
│       ├── loader.py                  80  read cleaned dir (parquet preferred → csv fallback)
│       ├── mapping.py                221  DataFrame row → SQL tuple (null-safe coercion)
│       └── reporting.py               28  write_manifest / append_log helpers
│
├── scripts/
│   ├── run_daily.py                  258  ✅ THE orchestrator (used by CI + docs)
│   ├── tier1_migration_check.py      483  ⚠️ one-off migration assertion ladder (needs a DB)
│   ├── tier1_migration_check.ps1     248  ⚠️ Windows wrapper: boots local PG18, runs the .py
│   └── live_db_check.ps1             523  ⚠️ Windows e2e store/views verification ladder
│
├── tests/                             13 files, 1,629 lines, run with plain `pytest`
│   ├── conftest.py                     6  puts repo root on sys.path
│   ├── fixtures/sample_raw.jsonl      10  10 records, all 20 contract keys + edge cases
│   ├── test_scrape.py                342  parsers, robots gate, proxy, CLI pins
│   ├── test_clean.py                 358  scoring rule, derived columns, CLI, dtypes
│   ├── test_run_daily.py             128  stage commands, skip logic, run_log
│   ├── test_store_cli.py              72  pre-flight failures, run-id resolution
│   ├── test_store_db.py               53  DSN redaction, URL sources, upsert shape
│   ├── test_store_flow.py            184  full cli.main against a FakeConn
│   ├── test_store_loader.py           75  parquet/csv preference, date-from-filename
│   ├── test_store_mapping.py         158  row → tuple mapping + validation
│   ├── test_store_stale.py            91  _MARK_STALE SQL + cold-start gate
│   ├── test_schema_sqlglot.py         95  parses schema/migration/views with sqlglot
│   └── test_workflow_yaml.py          57  pins the workflow's 6 secrets + cron
│
├── sql/
│   ├── schema.sql                     87  listings / listing_snapshots / pipeline_runs + indexes
│   ├── vercel_readonly_role.sql       45  offmarket_reader role + 4 SELECT grants
│   └── migrations/
│       └── 2026-10-16_tier1_is_active.sql  62  auditable record of the is_active column
│
├── dashboard/                         Stage 4 (Power BI, offline)
│   ├── views.sql                     122  3 views: vw_latest_listings, vw_zip_price_drop_30d, vw_listing_history
│   ├── dax_measures.dax               48  6 measures
│   ├── build_guide.md                401  click-by-click Power BI build (Steps 0–10)
│   └── verify_contract.py            244  sqlglot checker: views↔contract, DAX↔guide (manual, 54 checks)
│
├── docs/
│   ├── data_contract.md              156  ⭐ THE source of truth for fields/CLI/DDL/scoring
│   ├── roadmap.md                    473  tiered plan + long Tier-1 build log (⚠️ half changelog)
│   ├── websiteplan.md                167  V1 site build plan (now a status doc)
│   ├── apply_tier1_migration.md      241  completed migration runbook + hazards H1–H3
│   ├── deploy_github.md               72  CI + Neon secret wiring
│   └── robots_precheck.md             48  dated compliance pre-flight record + operating limits
│
├── site/                              Next.js 15 + React 19 + Tailwind v4 (Vercel)
│   ├── app/                          16 files, 1,689 lines
│   │   ├── layout.tsx                 99  root chrome: header/nav/freshness/footer + metadata
│   │   ├── page.tsx                   24  `/` — HeroStats + compact Explorer + 3 static cards
│   │   ├── map/{layout,page}.tsx     2+5  `/map` — metadata layout + `<Explorer />`
│   │   ├── trends/{layout,page}.tsx 14+493 `/trends` — KPIs + 7 Recharts charts + top-10 table
│   │   ├── data/{layout,page}.tsx    14+418 `/data` — sortable/paginated call list + CSV + SideCard
│   │   ├── globals.css               107  tokens, .panel/.eyebrow/.tap, maplibre styling
│   │   ├── icon.svg                    6  favicon
│   │   ├── opengraph-image.tsx       101  generated 1200×630 social card
│   │   ├── robots.ts / sitemap.ts  16+25  robots.txt (disallow /api/) + 4-route sitemap
│   │   └── api/
│   │       ├── deals/route.ts       141  ⭐ data backbone: filtered JSON or CSV
│   │       ├── health/route.ts      100  ingestion health (runs, coverage, next_run_at)
│   │       ├── meta/route.ts         41  header freshness strip
│   │       ├── zips/route.ts         14  per-ZIP daily trends for /trends
│   │       └── listing/[id]/route.ts 50  one listing's price history (sparkline)
│   ├── components/                   12 files, 1,559 lines (all "use client")
│   │   ├── Explorer.tsx             245  compact + full explorer shells (⚠️ 3 components in 1 file)
│   │   ├── SideCard.tsx             336  property dialog: history, sparkline, shortlist
│   │   ├── IngestionHealth.tsx      198  the health card
│   │   ├── DealMap.tsx              162  MapLibre + supercluster pins
│   │   ├── Filters.tsx              157  filter sidebar
│   │   ├── HeroStats.tsx             93  home hero + KPIs
│   │   ├── PriceSparkline.tsx       119  hand-rolled inline SVG sparkline
│   │   ├── HScroll.tsx               70  scroll-hint wrapper for wide tables
│   │   ├── ShareLink.tsx             68  copy-link control with clipboard fallback
│   │   ├── Freshness.tsx             58  header "data as of" strip
│   │   ├── FilterNav.tsx             30  header nav preserving the query string
│   │   └── FilterNotices.tsx         23  "we could not honour that param" list
│   ├── lib/                          7 files, 850 lines
│   │   ├── db.ts                    207  ⭐ server: getSql() + all parameterised SQL over views
│   │   ├── types.ts                 200  ⭐ interfaces + score colours + applyFilters + date helpers
│   │   ├── useFilters.ts            171  URL-backed filter state + toDealsQuery + notices
│   │   ├── fallback.ts              104  frozen-CSV reader when the DB is unreachable
│   │   ├── useUrlSearch.ts          110  useSyncExternalStore replacement for useSearchParams
│   │   ├── market.ts                 36  MARKET_REFERENCE (22,801) + fmtCount + coverageNote
│   │   └── cron.ts                   22  CRON_SCHEDULE "0 10 * * *" + nextRunAt
│   ├── neon.ts                       20  Neon branch TTL config (read by lib/db.ts)
│   ├── public/data/listings_sample.csv 83  82-row frozen sample = the fallback dataset
│   └── package.json / tsconfig / next.config.mjs / postcss / .env.example / .gitignore /
│       .vercelignore / next-env.d.ts   config + generated files
│
└── jobs/                              179 files, 2.8 MB — run evidence & debug harnesses
    ├── robots/                        3  ⭐ compliance snapshots (zillow/realtor/redfin robots)
    ├── smoke-scrape-20261015-084632   2  store record of the 82-row production sample load
    ├── full-scrape-20261016{,b}    1+1  PerimeterX 403 abort evidence (both cited)
    ├── pg-live-20261014-223645       64  psycopg conn-close bug root-cause session (17 debug_*.py)
    ├── pg-fix-20261015-122253       18  ⭐ authoritative live-DB fix proof (31/31 PASS)
    ├── pg-fix-20261015-122203       20  ⚠️ superseded duplicate of the above
    ├── tier1-{ui-check,ui-fixes,cls-fix,cls-diagnosis,panel-verify,deployed-qa,gate-fixes}  60
    ├── tier1-migration-{apply,check,verify}   5  production migration transcripts
    ├── push-to-deploy-20261017        1  Vercel push-to-deploy record
    └── 20261014-000001 / 20261014-161000  1+3  ⚠️ two failed first runs
```

---

## 4. Invariants — must survive the refactor

These are pinned by tests, by the contract, or by legal/compliance requirements.
Breaking any of them breaks `pytest`, CI, or the project's permission to scrape.

| # | Invariant | Pinned by |
|---|---|---|
| I1 | Motivation rule: `High` = DOM>90 **AND** drop>5% · `Medium` = XOR · `Low` = neither (strict `>`) | `test_clean.py`, `data_contract.md` |
| I2 | Raw contract = exactly 20 keys; cleaned = 20 − `price_history` + 7 derived | `test_scrape.py`, `test_clean.py` |
| I3 | Score enum `'High','Medium','Low'` in code **and** DB CHECK | `mapping.py`, `schema.sql` |
| I4 | Upsert keys: listings `(source, listing_id)`; snapshots `(source, listing_id, snapshot_date)`; runs `(run_id)` | `db.py`, `test_schema_sqlglot.py` |
| I5 | Stale rule: `STALE_RUNS = 3` with the load-bearing `count(*) >= 3` cold-start gate | `db.py`, `test_store_stale.py` |
| I6 | `sql/schema.sql` must keep `ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active …` | `test_schema_sqlglot.py` (explicit regression) |
| I7 | `python -m src.scrape\|clean\|store` CLI signatures + defaults `5 / 150 / 2.0` | `test_scrape.py`, `test_run_daily.py` |
| I8 | Daily volume policy `30 pages / 120 details / 5.0s`, floor `MIN_DELAY = 2.0` | `run_daily.py`, `test_run_daily.py` |
| I9 | Workflow: cron `0 10 * * *`, exactly six secrets, `run_daily.py` invocation | `test_workflow_yaml.py` |
| I10 | Robots gate: https-only, host allowlist, no query, `DISALLOWED_PATH_PREFIXES` | `test_scrape.py` (14 param cases) |
| I11 | CAPTCHA = hard stop, never bypassed; secrets scrubbed from every error string | `http.py`, `config.py`, `test_scrape.py` |
| I12 | Column order in `mapping.LISTING_COLUMNS`/`SNAPSHOT_COLUMNS` == INSERT order in `db.py` | comment-only contract ⚠️ no test |
| I13 | `docs/data_contract.md` DDL == `sql/schema.sql` | ⚠️ **nothing checks this** — biggest hazard |
| I14 | Site degrades to frozen CSV (`live:false`) instead of erroring | `site/lib/fallback.ts`, all API routes |

---

## 5. Detailed maps

### 5.1 `src/scrape` — Stage 1 (7 files, 1,548 lines)

**Flow:** `cli.main` → `ScrapeRun.run()` → search phase (follow `pagination.nextUrl`) →
detail phase (price-cut listings first) → `parsers.build_record` merge → four artifacts.

| File | Lines | Purpose | Key contents |
|---|---:|---|---|
| `__init__.py` | 9 | Package marker | docstring only |
| `__main__.py` | 3 | `-m` entry | `raise SystemExit(main())` |
| `cli.py` | 85 | Argument front end | `MIN_DELAY = 2.0` (floors `--delay`), `build_parser()`, `main()` |
| `config.py` | 164 | Constants + policy | `load_dataimpulse_credentials()` (local.env wins over env, cached), `build_proxy_url()` (`__cr.us` US exit), `proxy_display()`, `scrub_secrets()`, `is_allowed_url()` (the robots gate), `url_slug()`; `DISALLOWED_PATH_PREFIXES` (22), `SEARCH_PATH_RE`, `DEFAULT_PAGE_URLS` |
| `http.py` | 151 | HTTP client | `ZillowClient` (persistent curl_cffi session, `_pace`, `fetch`), `FetchResult`, `CaptchaBlocked`, `RateLimited`, `looks_like_block()`, `utc_now_iso()` |
| `parsers.py` | 643 | Pure extraction | `extract_next_data`, `extract_json_ld`, `parse_search_page`, `extract_detail_property`, `build_record` (~190 lines, precedence detail>search>JSON-LD), `normalize_property_type` (18 rules), `parse_price_history`, `_derive_event`, coercions `as_int/as_float/ms_to_date` |
| `pipeline.py` | 493 | Orchestrator | `ScrapeRun` (`_search_phase`, `_detail_phase`, `_fetch` + `_guard_redirect`, `_rotate_session`, `_merge_search_card`), `resolve_run_id`, artifact writers `_write_jsonl/_write_pages_fetched/_write_manifest/_write_process_log/_finalize` |

**Entry point:** `python -m src.scrape --pages 5 --max-details 150 --out jobs/<run_id>/raw [--delay 2.0]` → exit `0|1`.

**Outputs:** `jobs/<run_id>/raw/{listings.jsonl, pages_fetched.json, manifest.json, process_log.md}` — always written, even on failure.

⚠️ See §7 for duplication and §8.1 for dead paths in this module.

---

### 5.2 `src/clean` — Stage 2 (4 files, 730 lines)

**Flow:** `read_jsonl` → `build_frame` → `transform` → `clean_file` → CLI writes
`listings_<date>.parquet` + `.csv` + `manifest.json` + `process_log.md`.

| File | Lines | Purpose | Key contents |
|---|---:|---|---|
| `__init__.py` | 30 | Re-export surface | 10 names re-exported — **none imported anywhere** |
| `__main__.py` | 6 | `-m` entry | `sys.exit(main())` |
| `cli.py` | 294 | Driver + evidence | `resolve_input`, `resolve_run_id` (flag→manifest→dir→`"unknown"`), `_build_log`, `_failed_log`, `_write_failure_artifacts`, `main` |
| `core.py` | 400 | The transformation | constants `RAW_COLUMNS`(20), `DROPPED_COLUMNS`, `DERIVED_COLUMNS`(7), dtype groups, `HIGH_DOM=90`, `HIGH_DROP_PCT=5.0`; `score_one()` (the rule), `pick_snapshot_date()` (majority UTC, tie→latest), `read_jsonl`, `build_frame`, `transform`, `clean_file`, `CleanStats` (12 fields), `utc_now_iso`, `RUN_ID_RE` |

**Entry point:** `python -m src.clean --in jobs/<run_id>/raw --out jobs/<run_id>/cleaned [--run-id]` → exit `0|1` (writes failed artifacts too).

---

### 5.3 `src/store` — Stage 3 (7 files, 788 lines)

**Flow:** validate (`DATABASE_URL`, columns) → **txn 1** apply schema + start run →
**txn 2** map rows + upsert listings + upsert snapshots → **txn 3** finish run + mark stale.

| File | Lines | Purpose | Key contents |
|---|---:|---|---|
| `__init__.py` | 11 | Error type | `StoreError(Exception)` |
| `__main__.py` | 6 | `-m` entry | `sys.exit(main())` |
| `cli.py` | 215 | Transaction driver | `EXIT_OK/FAILURE/CONFIG = 0/1/2`, `parse_args` (`--in --out --run-id --skip-schema`), `resolve_run_id`, `resolve_records_scraped`, `_write_evidence`, `main` |
| `db.py` | 227 | All SQL | `_INSERT_LISTING` + `_INSERT_SNAPSHOT` + `_START_RUN` + `_FINISH_RUN` + `_MARK_STALE`; `connect`, `get_database_url` (local.env via dotenv), `apply_schema`, `upsert_listings`, `upsert_snapshots`, `start/finish_pipeline_run`, `mark_stale_listings`, `redact_dsn`, `STALE_RUNS=3`, `count_rows` ⚠️ dead |
| `loader.py` | 80 | Read cleaned dir | `load_cleaned_dir` (parquet wins), `read_manifest`, `_date_from_filename`; `CLEANED_COLUMNS` ⚠️ dead |
| `mapping.py` | 221 | Row → tuple | `LISTING_COLUMNS`(13), `SNAPSHOT_COLUMNS`(12), `_py/_text/_float/_int/_bool/_date/_timestamp`, `require_columns`, `listing_tuple`, `snapshot_tuple`; `_REQUIRED_*` ⚠️ dead |
| `reporting.py` | 28 | Evidence helpers | `write_manifest`, `append_log`, `utc_now`, `iso` |

**Entry point:** `python -m src.store --in jobs/<run_id>/cleaned [--out] [--run-id] [--skip-schema]` → exit `0|1|2`.
**Requires:** `DATABASE_URL` (env or `config/database.local.env`).

---

### 5.4 `scripts/`, CI and config (1,512 + 530 lines)

| File | Lines | Used by daily pipeline? | Purpose |
|---|---:|---|---|
| `run_daily.py` | 258 | ✅ **Yes** (CI + README) | Builds the 3 stages, loads `config/*.local.env` additively, streams each stage's output into `jobs/<run_id>/run_log.md`, skips later stages after a failure, exits `0|1`. Flags `--skip-scrape --pages --max-details --delay --run-id` |
| `tier1_migration_check.py` | 483 | ❌ one-off | Assertion ladder A–G against a real PG (apply order, idempotency, upgrade guard, grants hazard H1, cold-start gate, view contract, recency guard). Imports shipped `src.store.db`/`mapping` |
| `tier1_migration_check.ps1` | 248 | ❌ one-off, **Windows-only** | Boots ephemeral local PostgreSQL 18 (port 55432), runs the `.py`, writes `jobs/<RunId>/evidence/assertions.txt` |
| `live_db_check.ps1` | 523 | ❌ one-off, **Windows-only** | 7-step e2e verification of `src.store` + `dashboard/views.sql`: idempotency, modified-price upsert, failure path, views. Originally written for the psycopg `Connection.__exit__` bug (**now fixed**, step 3 informational) |

**`.github/workflows/daily_pipeline.yml` (49 lines)** — only workflow.
`cron "0 10 * * *"` + `workflow_dispatch` → `windows-latest`, Python 3.14, `py -3 -m venv .venv`,
`pip install -r requirements.txt`, `scripts\run_daily.py`. Six secrets:
`DATABASE_URL`, `DATAIMPULSE_{LOGIN,PASSWORD,HOST,PORT,COUNTRY}`.
⚠️ No test step, no artifact upload — `jobs/` evidence dies with the runner.

**`config/*.env.example`** — `DATABASE_URL=` (Neon DSN); `DATAIMPULSE_{LOGIN,PASSWORD,HOST=gw.dataimpulse.com,PORT=823,COUNTRY=us}`.

**`.gitignore` (61)** — `*.local.env`, `.env*`, `.venv/`, `node_modules/`, `.next/`, `jobs/*/raw|cleaned|cleaned-modified/`, `jobs/probe/`, `jobs/*/evidence/*` (except `*.md`), `*.pbix`.
⚠️ Gaps: root-level `.vercel/`, `jobs/*/debug_*.py` (23 are committed anyway), `jobs/*/run_store_shim.py`.

**`requirements.txt` (33)** — see §8.3 for the 6 unused pins.

---

### 5.5 `site/` — Next.js 15 presentation layer (~4,300 lines)

**Server/client split:** pages are *server* components that render *client* components;
all data arrives client-side from `/api/*` after hydration.

#### Route map

| URL | Page file | Renders | Data source |
|---|---|---|---|
| `/` | `app/page.tsx` (24) | `HeroStats` + compact `Explorer` + 3 static insight cards | `/api/meta`, `/api/deals` ×2 |
| `/map` | `app/map/page.tsx` (5) | `<Explorer />` full | `/api/deals`, `/api/meta` |
| `/trends` | `app/trends/page.tsx` (493) | 4 KPIs, `IngestionHealth`, 7 charts, top-10 table | `/api/zips`, `/api/deals` |
| `/data` | `app/data/page.tsx` (418) | sortable/paginated table, CSV button, `SideCard` | `/api/deals` |
| `/api/deals` | `api/deals/route.ts` (141) | `{deals, live, count, window_days, latest_snapshot_date}` or CSV (≤5000) | `db.buildDealsQuery` → fallback CSV |
| `/api/health` | `api/health/route.ts` (100) | `Health` incl. `next_run_at`, `coverage_pct` | `HEALTH_QUERY` |
| `/api/meta` | `api/meta/route.ts` (41) | header freshness strip | `META_*_QUERY` |
| `/api/zips` | `api/zips/route.ts` (14) | `{trends, live}` — filter-independent | `ZIPS_QUERY` |
| `/api/listing/[id]` | `api/listing/[id]/route.ts` (50) | one listing's history (400 on bad id; DB error → 200 `unavailable`) | `LISTING_HISTORY_QUERY` |
| `/robots.txt`, `/sitemap.xml`, `/icon.svg`, `/opengraph-image` | `robots.ts`, `sitemap.ts`, `icon.svg`, `opengraph-image.tsx` | SEO/social | static |

`map/`, `trends/`, `data/` each have a **metadata-only `layout.tsx`** (client pages can't export `metadata`).

#### lib

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `db.ts` | 207 | `getSql`, `buildDealsQuery`, `ZIPS/META_RUN/META_SNAPSHOT/LISTING_HISTORY/HEALTH_QUERY` | server-only Neon read path; recency guard deliberately unparameterised (clamped int vs `max(snapshot_date)`) |
| `types.ts` | 200 | `Deal`, `ZipTrend`, `Meta`, `Health`, `DealsResponse`, `FilterState`, `DEFAULT_FILTERS`, `applyFilters`, `SCORE_COLORS`, `SCORE_PILL_TEXT`, `daysSince`, `lastSeenLabel`, `isCarriedOver`, `carriedOverBadge` | grab-bag: contract types + tokens + client filtering + date helpers |
| `useFilters.ts` | 171 | `useFilters`, `toDealsQuery`, `filterNotices` | URL-backed filter state; empty-vs-absent semantics |
| `useUrlSearch.ts` | 110 | `setUrlSearch`, `useUrlSearch`, `useUrlSearchReady` | `useSyncExternalStore` replacement for `useSearchParams` (the 0.558 CLS fix) |
| `fallback.ts` | 104 | `loadFallbackDeals`, `loadFallbackTrends` | hand-rolled CSV reader over `public/data/listings_sample.csv` |
| `market.ts` | 36 | `MARKET_REFERENCE` (22,801), `fmtCount`, `coverageNote` | disclosure denominator + formatting |
| `cron.ts` | 22 | `CRON_SCHEDULE`, `nextRunAt` | outside `app/api/*` because Next restricts route-module exports |

#### components (all `"use client"`)

| File | Lines | Used by | Purpose |
|---|---:|---|---|
| `Explorer.tsx` | 245 | `/`, `/map` | **3 components in one file**: `CompactExplorer`, `FullExplorer`, default dispatcher; fetches deals+meta |
| `SideCard.tsx` | 336 | Explorer ×2, `/data` | property dialog: history fetch, sparkline, reductions, localStorage shortlist |
| `IngestionHealth.tsx` | 198 | `/trends`, `/data` | health card (`className` prop never used) |
| `DealMap.tsx` | 162 | Explorer | MapLibre + supercluster, keyboard-operable pins |
| `Filters.tsx` | 157 | Explorer, `/data` | filter sidebar (labels via `useId`) |
| `HeroStats.tsx` | 93 | `/` | hero + 4 KPIs (2 unguarded fetches) |
| `PriceSparkline.tsx` | 119 | SideCard | pure inline-SVG sparkline |
| `HScroll.tsx` | 70 | `/data`, `/trends` | scroll-hint edge gradient for wide tables |
| `ShareLink.tsx` | 68 | `Filters`, `/trends` | copy-link with clipboard fallback |
| `Freshness.tsx` | 58 | root layout | "data as of" strip (no abort guard) |
| `FilterNav.tsx` | 30 | root layout | nav carrying the query string |
| `FilterNotices.tsx` | 23 | `Filters`, `Explorer`, `/trends` | param-disclosure list |

**Config:** `package.json` (scripts `dev/build/start/lint/typecheck` — ⚠️ `lint` has no eslint dep),
`tsconfig.json` (`strict: true`, alias `@/*`), `next.config.mjs` (`poweredByHeader:false`),
`postcss.config.mjs` (Tailwind v4), `.env.example` (**only `DATABASE_URL`**),
`neon.ts` (branch TTL policy), `public/data/listings_sample.csv` (82 rows, one snapshot date).

---

### 5.6 `tests/` — 113 functions / 142 collected

Run: `pytest` from repo root. **Not run in CI.** No `pytest.ini`/`pyproject.toml`.

| File | Lines | Tests | Covers |
|---|---:|---:|---|
| `conftest.py` | 6 | — | puts repo root on `sys.path` |
| `fixtures/sample_raw.jsonl` | 10 recs | — | all 20 contract keys; edge cases incl. exact 5.0% drop, DOM 91, missing keys, sqft 0 |
| `test_clean.py` | 358 | 30 | scoring rule + boundaries, derived columns, dtypes, CLI, snapshot date |
| `test_scrape.py` | 342 | 18 | 14-case robots gate, parsers/record shapes, CAPTCHA detection, CLI pins (⚠️ inline HTML fixtures, docstring cites non-existent `jobs/probe/`) |
| `test_run_daily.py` | 128 | 10 | stage commands, `--skip-scrape`, run_log, env loading |
| `test_store_flow.py` | 184 | 4 | full `cli.main` against `FakeConn` |
| `test_store_mapping.py` | 158 | 13 | row → tuple coercion/validation |
| `test_store_stale.py` | 91 | 7 | `_MARK_STALE` SQL + cold-start gate |
| `test_store_cli.py` | 72 | 6 | pre-flight failures, run-id helpers |
| `test_store_loader.py` | 75 | 7 | parquet/csv preference, filename date |
| `test_store_db.py` | 53 | 6 | DSN redaction, URL sources, upsert shape |
| `test_schema_sqlglot.py` | 95 | 8 | schema/migration/views parse + `is_active` ALTER guard |
| `test_workflow_yaml.py` | 57 | 4 | 6 secrets, no leaked values, cron, invocation |

⚠️ Two tests in `test_scrape.py` (`proxy_url…`, `scrub_secrets…`) **always skip** without
`DATAIMPULSE_*` credentials — dead in CI/clean environments.

---

### 5.7 `sql/` (194 lines)

- **`schema.sql` (87)** — applied on *every* store run, must be fully re-runnable.
  - `listings` — PK `(source, listing_id)`, descriptive + geo + `first_seen_at`/`last_seen_at`,
    `is_active boolean NOT NULL DEFAULT true` (no index, ~1k rows).
  - `ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active …` — the **upgrade guard**, deliberately
    in schema.sql (not only in migrations) because `CREATE TABLE IF NOT EXISTS` is a no-op on old tables.
  - `listing_snapshots` — `UNIQUE (source, listing_id, snapshot_date)` (the idempotency key),
    FK → `listings`, `motivation_score` CHECK, `scraped_at`.
  - `pipeline_runs` — `run_id` PK, `status` (`running|success|failed`, comment-only), counts, `notes`.
  - Indexes: `idx_listing_snapshots_snapshot_date`, `idx_listings_zip`.
- **`vercel_readonly_role.sql` (45)** — `offmarket_reader` + `GRANT SELECT` on the 3 views and
  `pipeline_runs` only (views run with owner privileges). Placeholder password.
- **`migrations/2026-10-16_tier1_is_active.sql` (62)** — `BEGIN/COMMIT` record of the column;
  duplicate of the schema guard; ends with a commented-out manual stale-marking UPDATE.

**Views are NOT here** — they live in `dashboard/views.sql` (`vw_latest_listings`,
`vw_zip_price_drop_30d`, `vw_listing_history`).

---

### 5.8 `dashboard/` (815 lines)

| File | Lines | Purpose |
|---|---:|---|
| `views.sql` | 122 | The 3 views consumed by **both** Power BI and `site/lib/db.ts` |
| `dax_measures.dax` | 48 | 6 measures: `Property Count`, `High Motivation Count`, `Avg Price Drop %`, `Avg DOM`, `Is DOM > 60`, `Avg Price Drop % (30d)` |
| `build_guide.md` | 401 | Step 0–10 Power BI build instructions. ⚠️ still says "two views" (there are three) |
| `verify_contract.py` | 244 | Manual sqlglot checker: views ↔ contract DDL, DAX ↔ guide ↔ views. Prints PASS/FAIL, exits 0/1. **Not in CI**, referenced only by README/docs |

---

### 5.9 `docs/` (1,157 lines)

| File | Lines | Purpose | Status |
|---|---:|---|---|
| `data_contract.md` | 156 | ⭐ **Source of truth**: field tables, CLI signatures, DDL, scoring, pacing | current — but DDL is duplicated from `schema.sql` by hand (§4 I13) |
| `roadmap.md` | 473 | Tier 1/2/3 plan **+** ~260 lines of Tier-1 build log | current, but half is a changelog restating `jobs/tier1-*/evidence/*` |
| `websiteplan.md` | 167 | V1 site plan, now a status doc | mostly matches `site/`; §5 names `Map.client.tsx` (actual: `DealMap.tsx`) |
| `apply_tier1_migration.md` | 241 | Completed migration runbook + hazards H1–H3 | completed but still the re-apply procedure |
| `deploy_github.md` | 72 | CI + Neon secret setup | current (⚠️ documents `DATAIMPULSE_COUNTRY`, which `config.py` never reads) |
| `robots_precheck.md` | 48 | Dated robots/compliance pre-flight + operating limits | current evidence record |

---

### 5.10 `jobs/` (179 files, 2.8 MB)

**Key finding: no code reads any existing `jobs/` directory.** Code only *writes* to
`jobs/<new_run_id>/` and *globs* `jobs/*/raw/listings.jsonl` (which is empty here, so
`--skip-scrape` errors by design). The only real dependency is **README/docs citations**.

| Verdict | Dirs | Reason |
|---|---|---|
| ⭐ **Keep — cited evidence** | `robots` (compliance), `pg-fix-20261015-122253` (31/31 proof), `smoke-scrape-20261015-084632` (source of the sample CSV), `full-scrape-20261016{,b}` (bot-block proof), `push-to-deploy-20261017`, `tier1-migration-apply`, `tier1-{ui-check,ui-fixes,cls-fix,cls-diagnosis,panel-verify,deployed-qa,gate-fixes}` evidence `.md` |
| ⚠️ **Deletable** | `pg-fix-20261015-122203` (superseded duplicate), `20261014-000001` + `20261014-161000` (failed uncited runs), `tier1-migration-check` (regenerable by re-running the script) |
| ⚠️ **Deletable bulk** | 4 PNGs in `tier1-ui-check` (**1.19 MB**, 63% of the tree), `tier1-deployed-qa/evidence/raw/axe.min.js` (553 KB vendored bundle), 73 `.py/.js/.ps1` one-off harnesses (keep `cls-init.js`) |
| ⚠️ **Archive judgement** | `pg-live-20261014-223645` `validation_report.md` (541 lines, the psycopg root-cause) vs its 17 `debug_*.py`; `tier1-migration-verify`, `tier1-panel-verify` |

**≈1.85 MB of 2.8 MB (66%) is recoverable without breaking a single citation.**

---

## 6. Who-depends-on-whom (internal dependency graph)

```
scripts/run_daily.py ──subprocess──▶ src.scrape · src.clean · src.store
.github/workflows/daily_pipeline.yml ──▶ scripts/run_daily.py

src/scrape:  pipeline ─▶ parsers · http ─▶ config ; cli ─▶ config · pipeline
src/clean:   cli ─▶ core
src/store:   cli ─▶ db · loader · mapping · reporting ; db ─▶ mapping

tests:  every src module + run_daily + workflow yaml + sql files
scripts/tier1_migration_check.py ─▶ src.store.db · src.store.mapping  (+ reads sql/, dashboard/, site/lib/db.ts)
dashboard/verify_contract.py ─▶ dashboard/views.sql + docs/data_contract.md + build_guide + dax

site:  app/api/* ─▶ lib/db (SQL) · lib/fallback · lib/types · lib/market · lib/cron
       app/pages ─▶ components ─▶ lib/*  (types.ts is imported by 19 files)
       lib/db ─▶ neon.ts + env DATABASE_URL ; lib/fallback ─▶ public/data/listings_sample.csv
```

**Most-imported files:** `site/lib/types.ts` (19), `site/lib/useFilters.ts` (4),
`site/lib/useUrlSearch.ts` (6), `src/scrape/config.py` (4),
`src/store/mapping.py` (4), `scripts/run_daily.py` (CI + 3 tests + 6 docs).

---

## 7. Duplication found (refactor targets)

### 7.1 Python

| Duplicated concept | Locations | Fix |
|---|---|---|
| `RUN_ID_RE` (regex `^\d{8}-\d{6}$`) | `scrape/pipeline.py`, `clean/core.py`, `clean/cli.py` (3 copies, 3 different fallbacks incl. `store/cli.py`) | one `src/common/runid.py` |
| `utc_now_iso()` | `scrape/http.py`, `clean/core.py` | same |
| `MANIFEST_KEYS` | `scrape/pipeline.py` (**never read there**), `clean/cli.py` (**used**) | same |
| Manifest writing (`json.dumps(indent=2)+"\n"`) | `clean/cli.py` inline vs `store/reporting.write_manifest` | use reporting |
| Boolean parsing | `clean._coerce_bool` `{true,1,yes}` vs `store.mapping._bool` `{true,t,1,yes,false,f,0,no}` | one helper + one token set |
| Integral-float → string (zip codes) | `clean._fmt_str` vs `store.mapping._text` | one helper |
| Robots host allowlist + path prefixes | `config.is_allowed_url` **and** `pipeline._guard_redirect` (gating runs **twice** per request) | gate once, reuse |
| `resolve_run_id` precedence | `clean/cli.py`, `store/cli.py`, `scrape/pipeline.py` | one helper, one fallback policy |

### 7.2 TypeScript / React

| Duplicated concept | Locations | Fix |
|---|---|---|
| `/api/deals` fetch effect | **5 writes, 2 guard styles**: `Explorer` compact + full (`dead` flag), `data/page`, `trends/page` (`AbortController` + tri-state), `HeroStats` (unguarded) | `useDeals(query)` hook |
| `/api/meta` fetch | `Freshness`, `HeroStats`, `Explorer` | `useMeta()` |
| Money / percent formatting | ~10 sites: `SideCard.money`, `Explorer`, `data.cell`, `trends.fmtUsd`, `…toFixed(1)%` ×5 | `lib/format.ts` (`fmtMoney`, `fmtPct`) |
| Score colour palette | `globals.css`, `lib/types.ts`, `opengraph-image.tsx` | tokens → one module |
| Origin URL | `layout.tsx`, `robots.ts`, `sitemap.ts`, `opengraph-image.tsx` | one constant (robots/sitemap can't import it? verify) |
| `SCORES = ["High","Medium","Low"]` | `Filters`, `Explorer`, `useFilters`, inline in `trends` ×2, `db.ts` | export from `types.ts` |
| Score pill markup | `Explorer` chips, `SideCard` pills, local `ScorePill` in `data` | `components/ScorePill.tsx` |
| `source:listing_id` row key | `SideCard.shortKey`, `data.rowKey`, `trends` inline | helper in `types.ts` |
| Null-number parsing | `fallback.num`, `deals.numOrNull`, `health.toNum`, `SideCard.num` | one util |
| Coverage % maths | `health.coveragePct` (always 1dp) vs `market.coverageNote` (1dp <10% else int) — **can disagree** | one function |
| `toggleScore` array add/remove | `Explorer`, `Filters` | one helper |
| URL writing (`router.replace` + `setUrlSearch`) | `useFilters`, `data.writeView`, `useUrlSearch` | generic `useUrlState` |
| `max(snapshot_date)` | `deals.maxSnapshotDate`, `health`, `meta` inline (3 impls) | helper |

### 7.3 Cross-language

- The **motivation rule** is written in Python (`score_one`), in the site's client
  (`applyFilters`/type contract), and re-declared in SQL (views). Only Python is tested against
  the rule; the SQL view definitions are checked by `verify_contract.py` but not against Python.
- Timestamp styles differ: `clean`/`scrape` emit `...Z`, `store/reporting.iso` emits `+00:00`.

---

## 8. Dead code & deletion candidates

### 8.1 Dead paths inside live modules

| Item | File | Evidence |
|---|---|---|
| `html_dir` / `_save_html()` | `scrape/http.py` | never passed by `pipeline._new_client()` — always returns early. `config.url_slug` exists **only** for it |
| `MANIFEST_KEYS` | `scrape/pipeline.py:44` | defined, never read |
| `FetchResult` import | `scrape/pipeline.py:42` | annotation-only |
| `_rotate_session` sticky branch | `scrape/pipeline.py` | dormant: `DEFAULT_SESSION = None` |
| `head = html[: len(html)]` no-op | `parsers.py:214` | remnant of a truncated-`head` experiment |
| `if __name__ == "__main__"` guards | `scrape/cli.py`, `clean/cli.py` | unreachable (relative imports break direct execution; `__main__.py` is the entry) |
| `count_rows()` | `store/db.py` | exported, never called |
| `CLEANED_COLUMNS` | `store/loader.py` | never referenced |
| `_REQUIRED_LISTING` / `_REQUIRED_SNAPSHOT` | `store/mapping.py:52-53` | never referenced |
| Whole re-export surface | `clean/__init__.py` | no file imports `from src.clean import …` |
| `PROPERTY_TYPES` | `scrape/parsers.py` | asserted by tests, never enforced at runtime |
| `_credentials_cache` never invalidated | `scrape/config.py` | stale creds if env/file changes mid-process |

### 8.2 Over-exported TS symbols (safe to make private / relocate)

`SideCard.toggleShortlist` (used only in its own file), `useUrlSearchState`,
`useFilters.unrecognisedScores`/`unrecognisedMinDom`, `IngestionHealth({className})` (never passed).

### 8.3 Unused Python dependencies (`requirements.txt`)

Verified by grepping every import in the repo:

- **Unused direct pins:** `colorama`, `SQLAlchemy`, `requests`, `httpx`, `beautifulsoup4`, `lxml`
- **Orphaned transitives (drop if the above go):** `charset-normalizer`, `urllib3`, `soupsieve`,
  `anyio`, `httpcore`, `h11`, `idna`, `six`* (*`six`/`python-dateutil`/`tzdata` come via pandas — keep those three*)
- **Keep:** `curl_cffi` (+`certifi`,`cffi`,`pycparser`), `pandas`,`numpy`,`pyarrow`,
  `psycopg`+`psycopg-binary`, `pytest` (+`iniconfig`,`pluggy`,`packaging`,`Pygments`),
  `python-dotenv`, `sqlglot`, `typing_extensions`

### 8.4 Ranked file-level deletion candidates

1. `jobs/tier1-ui-check/evidence/*.png` — **1.19 MB**, keep the reports.
2. `jobs/tier1-deployed-qa/evidence/raw/axe.min.js` — 553 KB re-downloadable vendor bundle.
3. `jobs/pg-fix-20261015-122203/` — whole dir, superseded duplicate (README cites `…122253`).
4. `jobs/20261014-000001/`, `jobs/20261014-161000/` — failed, uncited runs.
5. 73 one-off `.py/.js/.ps1` harnesses under `jobs/*` (keep `cls-init.js`, and the 4 shims only
   if you want `live_db_check.ps1` reproducible).
6. `scripts/live_db_check.ps1` + `scripts/tier1_migration_check.{py,ps1}` — **Windows-only,
   one-off, bug already fixed.** ⚠️ They are currently the *only* real-database tests in the repo
   (pytest asserts SQL *text*, not behaviour). Recommend: archive to `docs/` or convert the
   valuable assertions into `tests/` marked `@pytest.mark.db`.
7. `dashboard/verify_contract.py` — not dead, but homeless: either wire it (plus `pytest`) into CI,
   or move it under `scripts/`.
8. `requirements.txt` unused pins (§8.3).

---

## 9. Documentation drift (fix or delete during the reorg)

> **Dispositions recorded 2026-10-22** by the phase-4-D documentation pass, in a
> separate column so the baseline claims above stay as written.

| Claim | Reality | Disposition (2026-10-22) |
|---|---|---|
| README repo-layout block | omits `tier1_migration_check.*`, `sql/migrations/`, `vercel_readonly_role.sql`, `verify_contract.py`, `tests/fixtures/`, `apply_tier1_migration.md` | ✅ **FIXED** — README § Repo layout rewritten; also adds `src/common/`, `docs/decisions.md`, `docs/incidents/` |
| README "`jobs/ … (evidence, gitignored)`" | 179 jobs files **are tracked**, incl. 82 `.txt` that predate the ignore rule | ✅ **FIXED** — README states markdown evidence is tracked / data dumps gitignored; new `jobs/README.md` documents the keep-cited rule + git-recoverability |
| README "test count is now 142" | matches (113 functions + parametrisation) ✅ but only if pytest is run | ✅ **FIXED** — README now says **155 passed, 2 skipped** (re-run 2026-10-22); count has since grown twice |
| README "~150 requests" vs `run_daily.py` "~155" | same 30+120 policy, two numbers | ✅ **RESOLVED, no code change** — both numbers are true: 30+120 = **150** (new policy), 5+150 = **155** (old default, which `run_daily.py`'s comment compares against). README now states both and their relationship |
| README verification row 1 (`run 20261016-055515`) | no such `jobs/` dir — CI uploads no artifacts | ✅ **ANNOTATED** — row 1 now states CI runs leave no `jobs/` evidence by design (runner disk dies with them) |
| `build_guide.md` "two views" | `views.sql` creates **three** (`vw_listing_history` missing) | ⚠️ **ASSESSED, NOT EDITED** — the "two views" sentences read correctly *for the Power BI model* (it loads 2 of the 3; `vw_listing_history` is site-only). Flagged in `dashboard/README.md`; the guide is a dashboard-owner runbook, outside the doc pass's ownership |
| `docs/websiteplan.md` §5 `Map.client.tsx` | actual component is `DealMap.tsx` | ✅ **FIXED** — the layout sketch marks both `Map.client.tsx` and `lib/db.ts` as formerly, naming the current paths (`components/listings/DealMap.tsx`, `lib/db/`) |
| `docs/deploy_github.md` `DATAIMPULSE_COUNTRY` | `src/scrape/config.py` never reads it (country is baked into `__cr.us`) | ✅ **FIXED** — the secrets table now says exported-but-unread by the pipeline (`__cr.us` in `src/scrape/proxy.py`); the secret stays because the workflow's six are pinned by `tests/test_workflow_yaml.py` |
| `src/scrape/parsers.py` + `tests/test_scrape.py` reference `jobs/probe/*.html` | that directory does not exist (gitignored) | ✅ **GONE/ANNOTATED** — `parsers.py` deleted in phase 2; the test-file reference was removed in phase 0 (fixtures now `tests/fixtures/zillow_pages.py`, which mentions the old path as history). The one remaining citation, `docs/incidents/2026-10-15-proxy-sticky-403.md`, now annotates that `jobs/probe/` was never tracked |
| `site/package.json` `lint` script | no `eslint` dependency or config anywhere → `npm run lint` fails/prompts | ⚠️ **OPEN (not owned)** — documented as a known gap in root README § Quickstart ("The site") and `site/README.md`; the fix belongs to the site owner (`package.json` is code-adjacent) |
| README: every command is Windows (`py -3`, `.venv\Scripts\`, `copy`) | no POSIX variants; neither `.ps1` runs on this Linux machine | ✅ **FIXED** — Quickstart rewritten with both a POSIX block (conda interpreter `~/.anaconda3/envs/off-market-radar/bin/python`) and a Windows block; POSIX block notes both `.ps1` are Windows-only |

---

## 10. Test coverage gaps (worth closing while refactoring)

1. **`site/` has zero automated tests** — no test script, no `*.test.*`. The recency guard, URL
   filter semantics, API routes, CSV export and the CLS/a11y fixes were verified only by ad-hoc
   harnesses under `jobs/tier1-*`.
2. **CI runs no tests at all** — `daily_pipeline.yml` has no `pytest`, no `verify_contract.py`.
3. **Contract ↔ schema parity is untested** (I13): `data_contract.md`'s DDL and `sql/schema.sql` are
   hand-maintained copies; nothing diffs them, and nothing checks `mapping.LISTING_COLUMNS` (13/12)
   against the actual table column sets (I12 is comment-only).
4. **Scrape enforcement loop untested** — gating wiring, 429/Retry-After honouring, pacing,
   `pages_fetched.json` audit, CAPTCHA→`failed` flow.
5. **DB behaviour is string-matched** — `_MARK_STALE`, upserts and `apply_schema` are asserted as
   SQL text + fake cursors; real execution lives only in the Windows `.ps1` scripts.
6. Credential-dependent tests skip silently (no marker, no pytest config exists yet).
7. `store/reporting.py` has no direct test.
8. `tests/conftest.py`'s `sys.path` hack can go once a `pyproject.toml` with `pythonpath = .` exists.

---

## 11. Suggested reorg directions (for discussion — not decided)

*Not applied; a starting point for the refactor session.*

- **Python:** introduce `src/common/` (or `src/shared/`) for `run_id`, timestamps, manifest
  writing, bool/text coercion; split `parsers.py` (643) into `coerce` / `extract` / `record`;
  split `pipeline.py` (493) into phases vs artifact writers; add a `pyproject.toml` so
  `conftest.py` and the CLI `if __name__` guards can go.
- **Scripts:** `scripts/pipeline/` (live) vs `scripts/verify/` (Windows one-offs) or archive;
  move `dashboard/verify_contract.py` into whichever group survives.
- **Site:** `components/ui/` (HScroll, ShareLink, PriceSparkline, ScorePill-new),
  `components/listing/` (SideCard, DealMap), `components/status/` (IngestionHealth, Freshness);
  split `lib/types.ts` into `api-types` / `scores` / `filters` / `dates` / `format`;
  extract `useDeals` + `useMeta`.
- **Jobs:** keep cited `.md` evidence, drop bulk (§8.4); consider `docs/evidence/` for the
  few reports README/docs actually cite.
- **Docs:** slim `roadmap.md`'s build log into `docs/buildlog.md`; fix §9 drift in one pass.
- **CI:** add `pytest` + `verify_contract.py` steps (and upload `jobs/` evidence as artifacts).
