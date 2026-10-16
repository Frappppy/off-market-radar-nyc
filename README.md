# Off-Market Radar — NYC

> **Live demo:** <https://off-market-radar-nyc.vercel.app>

**For:** real estate wholesalers, flippers, and local investment firms.
**Problem:** investors waste hours daily checking Zillow for *motivated* sellers —
properties with price drops and high days-on-market (DOM).
**Solution:** an automated daily pipeline that scrapes a city's listings, scores
seller motivation, stores a historical time-series in Postgres, and surfaces the
best deals two ways — a Next.js map/trends web app, and a Power BI dashboard for
the analyst view.

## How it works

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 1. SCRAPE   │ →  │ 2. CLEAN    │ →  │ 3. STORE    │ →  │ 4. VISUALIZE│
│ src/scrape  │    │ src/clean   │    │ src/store   │    │ dashboard/  │
│ Zillow NYC  │    │ Pandas      │    │ Neon/PG     │    │ Power BI    │
│ +DataImpulse│    │ Motivation_ │    │ daily upsert│    │ map + trend │
│  residential│    │ Score       │    │ time-series │    │ + slicer    │
│  proxies    │    │ $/SqFt      │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
        jobs/<run_id>/raw → cleaned →  SQL tables/views → Power BI Desktop
```

- **Step 1 — Scrape (`src/scrape`)**: static-first HTTP (curl_cffi, embedded-JSON
  parsing) against Zillow's robots-**allowed** paths, routed through DataImpulse
  residential proxies geo-targeted to the US (`__cr.us`), ≥2s pacing, run caps.
  Output: `jobs/<run_id>/raw/listings.jsonl` with address, price, price history
  ("Price Reduced"), DOM, property type, lat/long, and more.
- **Step 2 — Clean (`src/clean`)**: Pandas standardization — `address_std`,
  `price_per_sqft`, `price_drop_pct`, and the **`motivation_score`** rule:
  - `High`   — DOM > 90 **and** price drop > 5%
  - `Medium` — DOM > 90 **or** price drop > 5%
  - `Low`    — otherwise
  Output: Parquet + CSV with a full audit trail.
- **Step 3 — Store (`src/store`)**: Postgres schema (Neon-ready) with
  `listings` (current state), `listing_snapshots` (append-only daily
  time-series, idempotent upserts), and `pipeline_runs` (ops log).
  `scripts/run_daily.py` orchestrates all three stages.
- **Step 4 — Visualize (`dashboard/`)**: SQL views + DAX measures + a 10-step
  build guide for a Power BI dashboard: **clustered map** of high-motivation
  properties, **30-day trend line** of average price drops by zip, and a
  **DOM > 60 slicer** wired to both visuals.

## Repo layout

> **Note:** this project folder **is** the repository root. `.github/workflows/`
> (Actions only reads workflows from the repo root) and the gitignored `.venv/`
> live here too. All commands below run from the repo root.

```
.github/workflows/daily_pipeline.yml  cron: daily scrape -> clean -> store
.venv/             local interpreter (gitignored)
config/            proxy + DB connection templates (real values live in gitignored *.local.env)
docs/
  data_contract.md the binding field-level contract between all four stages
  robots_precheck.md  legality pre-flight record (see Compliance)
  deploy_github.md  how to wire GitHub Actions + Neon secrets
  websiteplan.md   Vercel build plan for the portfolio website (not the pipeline)
  roadmap.md       what comes next, in three tiers (credibility → differentiation → retention)
src/scrape … src/clean … src/store    the three pipeline stages (CLI: python -m src.<stage>)
sql/schema.sql     idempotent DDL (Neon/Postgres)
dashboard/         views.sql, dax_measures.dax, build_guide.md
site/              Next.js presentation layer (map, trends, CSV export)
scripts/run_daily.py   daily orchestrator (used by GitHub Actions)
scripts/live_db_check.ps1  live Postgres end-to-end check (ephemeral local PG18)
jobs/<run_id>/     every run's raw/cleaned data, manifests, and process logs (evidence, gitignored)
tests/             pytest suite across all stages
```

## Quickstart

```powershell
# Run these from the repo root (this folder).

# 1. Python env (Python 3.14)
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. Secrets (gitignored — never committed)
copy config\dataimpulse.env.example config\dataimpulse.local.env   # fill in DataImpulse creds
copy config\database.env.example    config\database.local.env      # fill in Neon DATABASE_URL

# 3. Run the pipeline end to end
.venv\Scripts\python.exe scripts\run_daily.py

# Or stage by stage:
.venv\Scripts\python.exe -m src.scrape --pages 5 --max-details 150 --out jobs\<run_id>\raw
.venv\Scripts\python.exe -m src.clean  --in jobs\<run_id>\raw --out jobs\<run_id>\cleaned
.venv\Scripts\python.exe -m src.store  --in jobs\<run_id>\cleaned

# Verify:
.venv\Scripts\python.exe -m pytest tests/ -q
.venv\Scripts\python.exe dashboard/verify_contract.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live_db_check.ps1
```

Apply `sql/schema.sql` then `dashboard/views.sql` to your Neon database once,
then connect Power BI Desktop per `dashboard/build_guide.md`.

**Daily automation:** `.github/workflows/daily_pipeline.yml` (repo root — Actions
only reads workflows from there) runs the whole pipeline on a cron. Create the six repository secrets listed in
`docs/deploy_github.md` (`DATABASE_URL`, `DATAIMPULSE_*`). The repo never
contains credentials or scraped data dumps — both stay out of git by design.

## Target city

**New York, NY** (`https://www.zillow.com/new-york-ny/`) — change the city by
pointing the scraper at another Zillow search URL; everything downstream is
city-agnostic (zip/lat-long drive the map).

## Compliance & ethics (pre-flight recorded in `docs/robots_precheck.md`)

- **Realtor.com is excluded**: its robots.txt explicitly declares scraping
  unauthorized. It is not touched by any stage.
- **Zillow**: only robots-**allowed** paths (search pages + homedetails);
  `/api/`, `/graphql/`, and other disallowed paths are never requested.
- **Proxies ≠ permission**: DataImpulse residential proxies are used for IP
  hygiene and geo-accuracy (verified US/New York exit), at 5s pacing between
  **all** requests (2.5x the contractual 2s floor kept in `src/scrape/cli.py`),
  capped volume, and full 429/Retry-After compliance — portfolio scale, not bulk.
- **Daily volume**: 30 search pages + 120 detail pages per run (~150 requests —
  the same load as the original 5-page/150-detail default). Because a search page
  returns ~41 cards in one request while a detail page returns one listing in one
  request, the budget is spent where it buys coverage: Zillow NYC reports ~22.8k
  active listings, so a run samples roughly 5% of them — a deliberate, documented
  ceiling, not a full-market scrape. The numbers live in one place: `DAILY_PAGES`,
  `DAILY_MAX_DETAILS`, `DAILY_DELAY` in `scripts/run_daily.py`, pinned by
  `tests/test_run_daily.py`.
- **CAPTCHA is a hard stop**: any PerimeterX/CAPTCHA challenge aborts the run
  (manifest `status: failed`); the pipeline never attempts to defeat it.
- **Evidence chain**: robots snapshots, per-run manifests, `pages_fetched.json`
  audits, and process logs land in `jobs/` for every claim.

## Verification status

| Stage | Status |
|---|---|
| 1. Scrape | ✅ live-proxy runs — **1,011 records** (30 pages, 120/120 details) via CI run `20261016-055515`; earlier 82-record smoke run `jobs/smoke-scrape-20261015-084632` |
| 2. Clean | ✅ full pytest suite green; end-to-end on fixture verified |
| 3. Store | ✅ live-PG unshimmed fix — `with conn.transaction()` per transaction, 31/31 live checks (`jobs/pg-fix-20261015-122253`) |
| 4. Dashboard | ✅ sqlglot parse + DDL cross-check + DAX↔guide consistency (49 checks via `dashboard/verify_contract.py`) |

### Live data reality — what the website actually shows

The Vercel site reads Neon and the freshness strip reports `live: true`. "Live"
describes the **plumbing**; this section describes the **coverage**, because the
two are not the same thing.

As of 2026-10-16 the database holds **two** successful runs (see `pipeline_runs`):

| run_id | records | how it got there |
|---|---|---|
| `neon-prod-load-20261016` | 82 | manual load of the 2-page smoke scrape |
| `20261016-055515` | 1,011 | scheduled `daily_pipeline` (30 pages / 120 details) |

Current dataset, read through the read-only role's granted views:

- **1,019 rows** in `vw_latest_listings`; the latest snapshot (2026-10-16) holds
  **1,011 listings** — roughly **4.4%** of the ~22.8k active NYC listings Zillow
  reports. A sample at portfolio scale, capped on purpose.
- **2 snapshot dates** (2026-10-15, 2026-10-16), so the Trends page has a genuine
  second point for ZIPs present in both — and gains one point per daily run.
- **157 distinct ZIPs**, **211 (zip, date) rows** in `vw_zip_price_drop_30d` —
  spread across all five boroughs rather than one.
- Score mix: **43 High / 114 Medium / 862 Low**.
- **138 rows carry a price cut**; 892 carry $/sqft and 1,012 carry coordinates.
  `price_drop_pct` only exists for detail-enriched rows, and the 120-per-run
  detail budget is aimed at site-flagged "Price cut" listings first.

Known limits, stated plainly:

- The frozen CSV fallback (`site/public/data/listings_sample.csv`) is still the
  82-row smoke sample, byte-identical to `jobs/smoke-scrape-20261015-084632`. It
  renders only when Neon is unreachable, and it is **not** the live dataset — so
  a fallback render legitimately looks smaller than the live site.
- Coverage is capped by design, not by accident: this is ~4% of the market, and
  every extra percent costs requests against a site that actively challenges
  automation. The ceiling is a deliberate compliance choice.

### Ingestion was blocked earlier the same day — and why that matters

On 2026-10-16 two manual large runs were served a PerimeterX challenge (HTTP 403)
on their **very first** request and aborted, writing 0 records
(`jobs/full-scrape-20261016{,b}/run_log.md`). Roughly 30 minutes later the
scheduled CI run — same proxy pool, same 5s pacing — completed all ~150 requests
and loaded 1,011 listings.

So the block was transient pool reputation, not our volume (it failed on request
#1, before volume could matter), and not a permanent wall. The stop rule is
unchanged and unconditional: **any CAPTCHA challenge aborts the run**, and there
is no retry-until-it-passes logic anywhere in the pipeline.

`docs/websiteplan.md` is the Vercel build plan for the portfolio website
(kept here for convenience — it is not part of the data pipeline).

*Honest gaps noted as they arise: see each stage's process log under `jobs/`
and `dashboard/build_guide.md` Step 10 for GUI steps that can't be verified
headlessly (Power BI visuals, Neon live connection).*
