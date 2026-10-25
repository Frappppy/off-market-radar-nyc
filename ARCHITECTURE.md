# ARCHITECTURE.md — Off-Market Radar NYC

> **Describes:** the working tree as of **2026-10-25** — the post-review fix
> pass, pushed to `main` as **`dc5e74f`** ("blocks fail loudly, dead runs get
> recorded, the site stops over-claiming") together with the interpreter-target
> correction that `checks.yml`' own first run forced (see the `[tool.mypy]`
> note in `pyproject.toml`). The refactor itself landed earlier: `4668dfb` →
> `1c5c047` (2026-10-22), with the guardrail CI in `4e716f1`
> ([REFACTOR_PLAN.md](REFACTOR_PLAN.md)).
> Verified **2026-10-25**: `pytest` **220 passed** · `ruff check src scripts
> tests dashboard` + `mypy src` clean · `dashboard/verify_contract.py` **54/54**
> · all four CLIs `--help` exit 0. Caveat that still holds: `mypy src` is green
> here because the *runtime* interpreter (3.14) and the declared target now
> agree — the local env carries numpy 2.4.6 while `requirements.txt` pins
> 2.5.4, so CI is the only place the pinned stubs are actually parsed.
>
> Orientation order for a new human/agent: **this file → the directory README
> (`README.md` in each dir) → the file's own T0 header**. Detail sources:
> [docs/data_contract.md](docs/data_contract.md) (fields/DDL/CLI contract),
> [docs/decisions.md](docs/decisions.md) (why each rule is what it is),
> [REPO_MAP.md](REPO_MAP.md) (dated baseline "as of `6be2c61`" — old paths there
> are historical).

## 1. The system in one screen

```
              scripts/run_daily.py  (orchestrator, UTC run_id = YYYYMMDD-HHMMSS)
              .github/workflows/daily_pipeline.yml  (cron 0 10 * * *, windows-latest)
                                   │
      ┌────────────────────────────┼────────────────────────────┐
      ▼                            ▼                            ▼
python -m src.scrape       python -m src.clean         python -m src.store
Stage 1 SCRAPE             Stage 2 CLEAN               Stage 3 STORE
curl_cffi + DataImpulse    pandas + motivation_score   psycopg3 → Neon/Postgres
      │                            │                            │
      ▼                            ▼                            ▼
jobs/<run_id>/raw/          jobs/<run_id>/cleaned/      jobs/<run_id>/store/
  listings.jsonl              listings_<date>.parquet     manifest.json
  pages_fetched.json          listings_<date>.csv         process_log.md
  manifest.json               manifest.json                      │
  process_log.md              process_log.md                     ▼
      │                                                    Postgres
      │                                 listings · listing_snapshots · pipeline_runs
      │                                             │                │
      │                                             ▼                ▼
      │                              dashboard/views.sql       site/lib/db/* (read-only)
      │                              → Power BI (offline)      → Next.js app: pages
      │                                                          / · /map · /trends ·
      │                                                          /data · /listing/[id]
      ▼
docs/data_contract.md   ← the binding contract every stage is written against
```

**Two DB consumers:** `dashboard/` (Power BI, offline) and `site/` (Next.js,
read-only role `offmarket_reader` / Neon `DATABASE_URL`). Secrets live only in
gitignored `config/*.local.env` and `site/.env.local`.

## 2. Stages: what each reads and writes

| Stage | Package | Reads | Writes | Entry point |
|---|---|---|---|---|
| 1 Scrape | `src/scrape/` (`parsing/` = extraction) | Zillow search + detail pages over DataImpulse proxy (robots-gated, ≥`MIN_DELAY` 2.0 s) | `jobs/<run_id>/raw/{listings.jsonl, pages_fetched.json, manifest.json, process_log.md}` — always written, even on failure | `python -m src.scrape --pages 5 --max-details 150 --out jobs/<run_id>/raw` |
| 2 Clean | `src/clean/` | `raw/listings.jsonl` | `jobs/<run_id>/cleaned/listings_<date>.{parquet,csv}` + manifest + process log | `python -m src.clean --in jobs/<run_id>/raw --out jobs/<run_id>/cleaned` |
| 3 Store | `src/store/` | cleaned dir (parquet preferred → CSV fallback) + `DATABASE_URL` | 2 transactions: apply schema + start run → upsert listings/snapshots + finish run `success` + mark stale (ONE commit, so a failed run never leaves fresh `last_seen_at`); `--record-failure` writes a `failed` row for a run that never got here; evidence in `jobs/<run_id>/store/` | `python -m src.store --in jobs/<run_id>/cleaned` (exit `0/1/2`) |
| — Shared | `src/common/` | — | run-id policy, `utc_now_iso`, manifest/log writers, coercion token sets | imported by all 3 stages |
| 4 Site | `site/` (Next.js 15) | Postgres views via `site/lib/db/*`; frozen CSV on DB error | JSON/CSV APIs + 5 pages | `cd site && npm run build` / `npm run dev` |
| 5 Dashboard | `dashboard/` | same views | Power BI (manual) | `python dashboard/verify_contract.py` (54 checks) |

Orchestration: `scripts/run_daily.py` runs the three stages as subprocesses,
streams output into `jobs/<run_id>/run_log.md`, skips later stages after a
failure, loads `config/*.local.env` additively (real env wins). A skipped stage 3
would otherwise leave no `pipeline_runs` row at all, so after any failure the
orchestrator calls `python -m src.store --record-failure` best-effort — that is
what makes `/api/health`'s failure count real rather than always zero.

## 3. The data contract (summary — source of truth is `docs/data_contract.md`)

- **Stage 1 → Stage 2:** exactly **20 raw keys** (`source, listing_id, url,
  address_raw, city, state, zip, latitude, longitude, price_current,
  price_previous, price_reduced, property_type, bedrooms, bathrooms,
  living_area_sqft, days_on_market, listed_date, price_history, scraped_at`).
- **Stage 2 → Stage 3:** 20 − `price_history` + **7 derived** (`address_std,
  snapshot_date, price_per_sqft, price_drop_abs, price_drop_pct,
  motivation_score, motivation_reason`); Parquet preferred, CSV fallback.
- **Stage 3 DDL:** `sql/schema.sql` (idempotent, re-applied every run), mirrored
  by hand in `docs/data_contract.md` — parity enforced by
  `tests/test_contract_parity.py`.
- **Keys:** `listings (source, listing_id)` · `listing_snapshots
  (source, listing_id, snapshot_date)` · `pipeline_runs (run_id)`.
- **Conventions:** `run_id = YYYYMMDD-HHMMSS` UTC; timestamps ISO-8601 UTC;
  money USD integers; every stage writes `manifest.json` + `process_log.md`.

## 4. Invariants I1–I14 (re-verified against disk 2026-10-21)

| # | Invariant | Real today? |
|---|---|---|
| I1 | Motivation rule: `High` = DOM>90 **AND** drop>5% · `Medium` = XOR · `Low` = neither (strict `>`), null-safe | ✅ `src/clean/score.py` (`HIGH_DOM=90`, `HIGH_DROP_PCT=5.0`) |
| I2 | Raw contract = 20 keys; cleaned = 20 − `price_history` + 7 derived | ✅ `clean/frame.RAW_COLUMNS`, `clean/derive.DERIVED_COLUMNS`, contract tables |
| I3 | Score enum `High/Medium/Low` in code **and** DB CHECK | ✅ code + `sql/schema.sql:64` (DB half **unpinned by tests** — see §6) |
| I4 | Upsert keys: listings `(source, listing_id)`; snapshots `(+ snapshot_date)`; runs `(run_id)` | ✅ `src/store/statements.py` `ON CONFLICT` clauses + schema PK/UNIQUE |
| I5 | Stale rule `STALE_RUNS = 3` with load-bearing `count(*) >= 3` cold-start gate | ✅ `statements._MARK_STALE`, `db.STALE_RUNS` |
| I6 | `sql/schema.sql` keeps `ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active …` | ✅ present + ordered after the CREATE |
| I7 | CLI signatures `python -m src.scrape\|clean\|store`, defaults `5 / 150 / 2.0` | ✅ `src/scrape/cli.py` (`MIN_DELAY = 2.0`) |
| I8 | Daily volume policy `30 pages / 120 details / 5.0 s`, floor `2.0` | ✅ `scripts/run_daily.py` `DAILY_*` constants |
| I9 | Workflow: cron `0 10 * * *`, exactly six secrets, `run_daily.py` invocation | ✅ `.github/workflows/daily_pipeline.yml` (runner: `windows-latest`) |
| I10 | Robots gate: https-only, host allowlist, no query strings, `DISALLOWED_PATH_PREFIXES` | ✅ `src/scrape/robots.py::is_allowed_url` (14 test cases) |
| I11 | CAPTCHA = hard stop, never bypassed; secrets scrubbed from error strings | ✅ `http.looks_like_block`, `proxy.scrub_secrets` (abort wiring **unpinned** — §6) |
| I12 | `mapping.LISTING_COLUMNS`/`SNAPSHOT_COLUMNS` order == INSERT column order == schema | ✅ INSERTs are f-strings built **from** those tuples (`statements.py`) |
| I13 | `docs/data_contract.md` DDL == `sql/schema.sql` | ✅ pinned by phase-0 parity tests (was the biggest hazard) |
| I14 | Site degrades to frozen CSV (`live:false`) instead of erroring | ✅ `site/lib/fallback.ts` used by all 5 `/api/*` routes (**unpinned** — §6) |

## 5. How to run everything (POSIX shown; Windows variants in `README.md`)

```bash
# Interpreter — conda env, no activation needed (see docs/decisions.md):
PY=~/.anaconda3/envs/off-market-radar/bin/python

$PY -m pytest -q                       # 220 passed (2026-10-25)
$PY -m ruff check src scripts tests dashboard   # 0 findings (pinned ruleset)
$PY -m mypy src                        # Success: 43 source files
$PY dashboard/verify_contract.py        # 54 / 54, exit 0
$PY scripts/run_daily.py               # full pipeline (needs config/*.local.env)
$PY -m src.scrape --pages 5 --max-details 150 --out jobs/<run_id>/raw
$PY -m src.clean  --in jobs/<run_id>/raw --out jobs/<run_id>/cleaned
$PY -m src.store  --in jobs/<run_id>/cleaned            # needs DATABASE_URL

cd site && npm run typecheck && npm run build           # tsc + next build
cd site && npm run dev                                  # localhost:3000
```

The 2 skips are `test_proxy_url_…`/`test_scrub_secrets_…`, which
`pytest.skip` without `DATAIMPULSE_*` credentials — expected on every machine
without proxy creds (they run in CI, which has the secret).

## 6. Verification map — invariant → the test that pins it

Every pairing below was confirmed with `grep -rn "def <test>" tests/` on
2026-10-21 and **re-verified 2026-10-22** (all 37 cited test functions exist;
the I1 `(90, 5.0) → Low` param, the I10 14-case matrix and the I12 13/12
placeholder counts were re-checked line by line). "UNPINNED (gap)" means no
test exists — do not claim one.

| Invariant | Test(s) in `tests/` |
|---|---|
| I1 | `test_clean_score.py`: `test_high_motivation_with_reason`, `test_high_boundary_dom_91_drop_5_5`, `test_drop_exactly_5_pct_is_not_high`, `test_score_one_null_safe_rules` (param: `(90, 5.0) → Low`) |
| I2 | `test_scrape.py::test_search_only_record_obeys_contract_shape` (exact 20-key set); `test_clean_derive.py::test_price_history_dropped_and_columns_ordered`; `test_contract_parity.py::test_stage1_field_table_matches_raw_columns`, `::test_stage2_derived_list_matches_derived_columns` |
| I3 | code half: `test_clean_score.py::test_all_scores_in_contract_enum`, `test_store_mapping.py::test_snapshot_rejects_bad_motivation_score` · **DB CHECK half: UNPINNED (gap)** — no test asserts the `CHECK (motivation_score IN …)` constraint |
| I4 | `test_schema_sqlglot.py::test_upsert_semantics_sql_matches_contract`, `::test_schema_is_idempotent_and_indexed` |
| I5 | `test_store_stale.py::test_stale_runs_default_is_three`, `::test_mark_stale_is_a_noop_until_enough_successful_runs_exist`, `::test_mark_stale_sql_guards_parameterizes_and_requires_success` |
| I6 | `test_schema_sqlglot.py::test_schema_carries_the_is_active_upgrade_guard` |
| I7 | `test_scrape.py::test_cli_defaults_match_contract` (5/150 + `MIN_DELAY==2.0`); `test_run_daily.py::test_build_stages_matches_contract`; `test_clean.py::test_python_dash_m_module_invocation`; store flags/failures: `test_store_flow.py::test_skip_schema_flag` + `test_store_cli.py::test_missing_database_url_exits_2` et al. |
| I8 | `test_run_daily.py::test_daily_volume_policy_is_what_the_docs_claim` (`(30, 120, 5.0)`); floor via `test_scrape.py::test_cli_defaults_match_contract` |
| I9 | `test_workflow_yaml.py::test_schedule_and_stages`, `::test_only_the_six_secrets_referenced` |
| I10 | `test_scrape.py::test_is_allowed_url` — 14 parametrised cases (allowed search/homedetails; rejects `/api/`, `/graphql/`, query strings, http, foreign hosts) · **gate wiring incl. `run._guard_redirect`: UNPINNED (gap — REPO_MAP §10.4)** |
| I11 | detection: `test_scrape.py::test_perimeterx_marker_is_detected`; scrubbing: `::test_scrub_secrets_masks_credentials` (skips without creds) · **abort→`status:failed` wiring: UNPINNED (gap)** |
| I12 | `test_contract_parity.py::test_mapping_listing_columns_match_schema`, `::test_mapping_snapshot_columns_match_schema`; placeholder counts: `test_store_db.py::test_statement_builder_shapes` (13/12 `%s`) |
| I13 | `test_contract_parity.py::test_contract_stage3_ddl_matches_schema_sql` + negatives `::test_diff_detects_dropped_column`, `::test_diff_detects_reordering`, `::test_extract_and_diff_flag_a_rename` |
| I14 | **UNPINNED (gap)** — `site/` has zero automated tests; fallback behaviour exists in `site/lib/fallback.ts` + all 5 API routes but only manual/Playwright evidence (`jobs/tier1-gate-fixes/evidence/gate-fixes.md`) |

## 7. Where the tests live

| Location | What it pins |
|---|---|
| `tests/test_clean.py` + `test_clean_{score,derive,frame}.py` | scoring rule + boundaries, derived columns, dtypes, frame edge cases, CLI |
| `tests/test_scrape.py` | parsers/record shapes, robots gate (14 cases), CAPTCHA detection, CLI defaults |
| `tests/test_contract_parity.py` | contract ↔ schema ↔ code column parity (I2/I12/I13) + negative drift tests |
| `tests/test_store_{cli,db,flow,loader,mapping,stale}.py` | stage-3 exit codes, DSN redaction, full flow on FakeConn, loader prefs, row→tuple, stale rule |
| `tests/test_schema_sqlglot.py` | schema/migration/views parse; `is_active` guard; upsert SQL |
| `tests/test_run_daily.py` | volume policy, stage commands, env loading |
| `tests/test_common.py` | `src/common` primitives (run-id, coercion) |
| `tests/test_workflow_yaml.py` | cron, six secrets, no leaked values |
| `tests/fixtures/` | `sample_raw.jsonl` (10 records), `zillow_pages.py` (inline HTML fixtures) |
| `dashboard/verify_contract.py` | views ↔ contract DDL ↔ DAX ↔ build guide (54 manual checks, not in CI) |
| `site/` | **no automated tests** — runtime evidence in `site/shots/` + `jobs/tier1-*/evidence/` |

Run config: `pyproject.toml` (`pythonpath=["."]`, `testpaths=["tests"]`).
CI (`.github/workflows/daily_pipeline.yml`) runs the **pipeline**, not pytest.

## 8. Directory map — one README per directory

Detail lives one hop down; each README is 10–25 lines: what's here, the one
trap, pointers to files' T0 headers (`WHAT/WHY/INPUTS/OUTPUTS/CALLERS`).
**38 READMEs, all written 2026-10-22.**

`src/README.md` · `src/common/` · `src/scrape/` · `src/scrape/parsing/` ·
`src/clean/` · `src/store/` · `site/README.md` · `site/app/` (+ `api/`,
`api/deals/`, `api/health/`, `api/listing/[id]/`, `api/meta/`, `api/zips/`,
`data/`, `listing/`, `listing/[id]/`, `map/`, `trends/`, `trends/charts/`) ·
`site/components/` (+ `explorer/ filters/ listings/ status/ ui/`) ·
`site/lib/` (+ `db/`) · `site/hooks/` · `tests/` (+ `fixtures/`) · `sql/`
(+ `migrations/`) · `dashboard/` · `scripts/` · `docs/` (+ `incidents/`) ·
`jobs/` (keep-cited rule + recovery: `jobs/README.md`)
