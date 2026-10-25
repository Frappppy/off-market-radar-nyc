# Off-Market Radar — NYC

> **Live demo:** <https://off-market-radar-nyc.vercel.app>

**For:** real estate wholesalers, flippers, and local investment firms.
**Problem:** investors waste hours daily checking Zillow for *motivated* sellers —
properties with price drops and high days-on-market (DOM).
**Solution:** an automated daily pipeline that scrapes a city's listings, scores
seller motivation, stores a historical time-series in Postgres, and surfaces the
best deals two ways — a Next.js map/trends web app, and a Power BI dashboard for
the analyst view.

**Orientation:** [ARCHITECTURE.md](ARCHITECTURE.md) (the system in one screen) →
this file → the `README.md` in each directory → the file's own T0 header
(`WHAT/WHY/INPUTS/OUTPUTS/CALLERS`). Why each rule is what it is:
[docs/decisions.md](docs/decisions.md). The pre-reorganisation tree is frozen in
[REPO_MAP.md](REPO_MAP.md) — paths there are historical.

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
  Output: Parquet + CSV with a full audit trail. An opt-in `--sanitize` guard —
  always on in `run_daily.py` — drops rows with no positive price and rows whose
  state is not `NY`, and nulls a `price_previous` that is more than 5× the
  current price (the row survives). `docs/decisions.md` §12 has the reasoning.
- **Step 3 — Store (`src/store`)**: Postgres schema (Neon-ready) with
  `listings` (current state), `listing_snapshots` (append-only daily
  time-series, idempotent upserts), and `pipeline_runs` (ops log).
  `scripts/run_daily.py` orchestrates all three stages.
- **Step 4 — Visualize (`dashboard/` + `site/`)**: SQL views consumed two ways —
  a Power BI dashboard (clustered map of high-motivation properties, 30-day
  trend line of average price drops by zip, DOM > 60 slicer; build guide in
  `dashboard/build_guide.md`) and the Next.js site below.

## Repo layout

> **Note:** this project folder **is** the repository root. `.github/workflows/`
> (Actions only reads workflows from the repo root) lives here too. All commands
> below run from the repo root.

```
ARCHITECTURE.md     the system map: stages, contracts, invariants, verification
LICENSE             MIT (code only — see License below: it is not data permission)
REPO_MAP.md         dated baseline of the pre-reorg tree (as of 6be2c61 — historical)
REFACTOR_PLAN.md    the reorganisation plan + phase logs (what moved where)
pyproject.toml      pytest config (pythonpath = ".", testpaths = "tests") + the
                    ruff ruleset and mypy scope that CI gates on
requirements.txt       pinned runtime env (curl_cffi/pandas/psycopg/playwright/…)
requirements-dev.txt   pinned CI-only tools on top of it (ruff, mypy)
.github/workflows/daily_pipeline.yml  cron: daily scrape -> clean -> store
.github/workflows/checks.yml          push/PR: ruff, mypy, headers, pytest, contract
config/             proxy + DB connection templates (real values in gitignored *.local.env)
docs/
  data_contract.md  the binding field-level contract between all four stages
  decisions.md      ADR-lite: why each irreversible choice was made
  incidents/        dated incident narratives (referenced by one-line pointers in code)
  apply_tier1_migration.md  completed production migration runbook + hazards H1–H3
  deploy_github.md  how to wire GitHub Actions + Neon secrets
  robots_precheck.md  legality pre-flight record (see Compliance)
  roadmap.md        what comes next, in three tiers (+ Tier-1 build log)
  websiteplan.md    the Vercel build plan (kept as a status doc)
src/
  common/           shared primitives: run-id policy, timestamps, evidence writers, coercion
  scrape/           Stage 1 (CLI: python -m src.scrape); parsing/ = the split-out parsers
  clean/            Stage 2 (python -m src.clean); score/frame/derive split out of core.py
  store/            Stage 3 (python -m src.store); statements.py holds all SQL text
sql/                schema.sql (idempotent DDL) + vercel_readonly_role.sql + migrations/
dashboard/          views.sql, dax_measures.dax, build_guide.md, verify_contract.py
site/               Next.js 15 presentation layer (5 pages, 5 JSON/CSV APIs, Vercel)
scripts/
  run_daily.py      daily orchestrator (used by GitHub Actions)
  tier1_migration_check.{py,ps1}  one-off migration ladder against a real PG (.ps1 boots local PG18)
  live_db_check.ps1 one-off live Postgres end-to-end check (Windows-only)
tests/              pytest suite incl. contract↔schema parity tests; fixtures/ holds the data
jobs/<run_id>/      every run's raw/cleaned data, manifests, and process logs — run evidence
                    (see jobs/README.md: markdown evidence IS tracked; data dumps and
                    screenshots are gitignored; every deletion is git-recoverable)
```

Every code directory carries its own `README.md` (10–25 lines: what lives there,
the one trap, pointers to each file's T0 header). They are generated by hand for
the 2026-10-21 reorganisation — if this block and a directory disagree, the
directory wins.

## Quickstart

### POSIX (Linux / macOS)

```bash
# Interpreter: conda env `off-market-radar`, used by literal path (no activation).
# Why not venv: system Python 3.14 here ships without `ensurepip` — see
# docs/decisions.md §6. Rebuild: ~/.anaconda3/bin/conda create -n off-market-radar python=3.14 pip -y
PY=~/.anaconda3/envs/off-market-radar/bin/python

# 1. Secrets (gitignored — never committed)
cp config/dataimpulse.env.example config/dataimpulse.local.env  # fill in DataImpulse creds
cp config/database.env.example    config/database.local.env     # fill in Neon DATABASE_URL

# 2. Run the pipeline end to end
$PY scripts/run_daily.py

# Or stage by stage:
$PY -m src.scrape --pages 5 --max-details 150 --out jobs/<run_id>/raw
$PY -m src.clean  --in jobs/<run_id>/raw --out jobs/<run_id>/cleaned
$PY -m src.store  --in jobs/<run_id>/cleaned

# 3. Verify
$PY -m pytest -q                  # 220 passed (2026-10-25). The DataImpulse-credential
                                  # tests now run because config/dataimpulse.local.env
                                  # exists; without it they skip.
$PY -m ruff check src scripts tests dashboard   # 0 findings — the CI lint gate
$PY -m mypy src                   # Success — the CI typecheck gate
$PY dashboard/verify_contract.py  # 54/54, exit 0
# scripts/*.ps1 are Windows-only; neither runs on this platform.
```

### Windows

```powershell
# Run these from the repo root (this folder). Python 3.14.

# 1. Python env
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

# 4. Verify
.venv\Scripts\python.exe -m pytest tests/ -q
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt   # ruff + mypy
.venv\Scripts\python.exe -m ruff check src scripts tests dashboard
.venv\Scripts\python.exe -m mypy src
.venv\Scripts\python.exe dashboard\verify_contract.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live_db_check.ps1
```

Apply `sql/schema.sql` then `dashboard/views.sql` to your Neon database once
(store re-applies the schema every run, so the first `python -m src.store` also
does it), then connect Power BI Desktop per `dashboard/build_guide.md`.

### The site

```bash
cd site
npm install
npm run typecheck && npm run build   # tsc --noEmit + next build
npm run dev                          # localhost:3000
```

Known gap: `npm run lint` has no eslint dependency or config behind it yet, so
it prompts/fails — use `npm run typecheck` as the gate.

**Daily automation:** `.github/workflows/daily_pipeline.yml` (repo root — Actions
only reads workflows from there) runs the whole pipeline on a cron. Create the six repository secrets listed in
`docs/deploy_github.md` (`DATABASE_URL`, `DATAIMPULSE_*`). The repo never
contains credentials or scraped data dumps — both stay out of git by design.

## Site routes

Five pages, five APIs, all SEO endpoints:

| URL | Page | Data source |
|---|---|---|
| `/` | computed overview: `HeroStats` KPIs + compact `Explorer` + filter-responsive `InsightCards` (no hardcoded cards) | `/api/meta`, `/api/deals` |
| `/map` | full explorer: MapLibre + supercluster map, filters, SideCard | `/api/deals`, `/api/meta` |
| `/trends` | KPIs, `IngestionHealth`, 7 charts (`app/trends/charts/`), top-10 table | `/api/zips`, `/api/deals` |
| `/data` | sortable/paginated call list + CSV export | `/api/deals` |
| `/listing/[id]` | **new** shareable property page: row + price history, sparkline, shortlist | `/api/listing/[id]` |

| API | Returns | Notes |
|---|---|---|
| `/api/deals` | filtered `{deals, live, …}` or CSV (≤5000 rows) | data backbone; recency guard on `max(snapshot_date)` |
| `/api/health` | runs, coverage, `next_run_at` | ingestion-health card |
| `/api/meta` | latest run + snapshot freshness | header strip |
| `/api/zips` | per-ZIP daily trends | filter-independent |
| `/api/listing/[id]` | one listing's current row + daily series | 400 on bad id; row → CSV fallback (`live:false`), series → `200 unavailable` |

Every API degrades to the frozen 82-row CSV with `live:false` when the DB is
unreachable — never an error page (invariant I14, reader in
`site/lib/fallback.ts`). `/robots.txt`, `/sitemap.xml`, `/icon.svg` and
`/opengraph-image` are generated too; the sitemap enumerates the 82
fallback-CSV listing ids (no `DATABASE_URL` exists at build time).

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
- **Daily volume**: 30 search pages + 120 detail pages per run — **150 requests
  exactly**. The original default was 5 search + 150 detail = **155** requests;
  `scripts/run_daily.py`'s policy comment calls the new budget "about the same
  load", spent where it buys coverage: a search page returns ~41 cards in one
  request while a detail page returns one listing in one request. Zillow NYC
  reports ~22.8k active listings, so a daily run samples roughly 5% of them.
  The numbers live in one place: `DAILY_PAGES`, `DAILY_MAX_DETAILS`,
  `DAILY_DELAY` in `scripts/run_daily.py`, pinned by `tests/test_run_daily.py`.
- **One-off full harvest** (2026-10-23): the whole market was walked once, as a
  separate, explicitly approved run — 177 ZIP shards, 22,577 raw records, at the
  same pacing and with the same abort-on-CAPTCHA rule (`python -m
  src.scrape.harvest`, resumable ledger in `jobs/full-harvest-20261023/`). It is
  **not** wired into the cron; `run_daily.py` is unchanged at 150 requests. Treat
  the resulting 97.9% coverage as a one-off snapshot, not the steady state.
- **CAPTCHA is a hard stop**: any PerimeterX/CAPTCHA challenge aborts the run
  (manifest `status: failed`); the pipeline never attempts to defeat it.
- **Evidence chain**: robots snapshots, per-run manifests, `pages_fetched.json`
  audits, and process logs land in `jobs/` for every claim (see
  `jobs/README.md` for the keep-cited rule).

## Verification status

| Stage | Status |
|---|---|
| 1. Scrape | ✅ live-proxy runs — **full harvest `jobs/full-harvest-20261023/`**: 177/177 ZIP shards, 22,577 raw records, manifest `success`, 99.2% of Zillow's reported 22,756. Earlier: **1,011 records** (30 pages, 120/120 details) via CI run `20261016-055515`, and an 82-record smoke run `jobs/smoke-scrape-20261015-084632`. CI runs leave **no `jobs/` evidence** — the runner's disk dies with it — so the CI figure is recorded here and in `docs/roadmap.md` |
| 2. Clean | ✅ 220 tests green; full-harvest run 22,577 → **22,317** after the opt-in `--sanitize` guard (147 zero-price, 113 out-of-market dropped; 10 prior prices nulled) — `jobs/full-harvest-20261023/cleaned/` |
| 3. Store | ✅ live-PG load of the full harvest, 22,317 records in ~23 s (`jobs/full-harvest-20261023/store/`); unshimmed transaction fix verified earlier with 31/31 live checks (`jobs/pg-fix-20261015-122253`) |
| 4. Dashboard | ✅ sqlglot parse + DDL cross-check + DAX↔guide consistency (54 checks via `dashboard/verify_contract.py`) |

### Website — Tier 1 of the roadmap: built, migrated, deployed, hardened

The credibility tier (`docs/roadmap.md`) is implemented and live at
<https://off-market-radar-nyc.vercel.app>, deployed automatically from `main` on every push
(2026-10-17; see **Deploy mechanics** below): stale listings no longer presented as
current, a per-listing price-history panel, shareable filter links, and an ingestion
health card that reports the run which produced the data. A mistyped `?min_dom=` no
longer falls back to the frozen sample.

A second pass then closed twelve design-QA findings (S1–S12: contrast, tap targets,
keyboard-reachable map pins, unnamed controls, clipped columns), fixed two bugs found
afterwards — a price cut counted once per snapshot day, and `og:image` / `og:url` /
`twitter:image` / `rel="canonical"` all absent — and removed a **site-wide layout-shift
defect**: every route served a ~150-character `<main>` placeholder because the filter
state used `useSearchParams()`, so the 465 px footer sat inside the first screen and
jumped **0.558** when hydration filled the page in. All four routes still prerender
(`○ Static`, zero bailout markers), and measured CLS is now under 0.1 in all twelve
route × viewport cells, from up to 1.03. Fixes and numbers: `docs/roadmap.md`
§ "Post-deploy hardening round".

A third pass — the first run of **automated** gates — then refuted one of those claims: a
`/trends` deep link rendered the *default* cohort (133 rows) instead of the linked one (43)
in most runs, because the layout-shift fix's external store returns an empty string on its
first render, so every filter-aware fetch ran once against the SSR default and raced the
reader's real query — and `/trends` was the only one of the three pages without a staleness
guard, so the stale response won. Fixed and re-proved with six consecutive loads per route:
43 six times out of six, and exactly **one** `/api/deals` request per load, so the wasted
request is gone rather than merely losing the race. The same pass found axe violations the
manual rounds had missed — `/trends` `svg-img-alt` at **78 nodes**, an empty table header,
an unnamed SVG control, and `/map` heading order — all now fixed, with every route ×
viewport cell at 0 violations and the chart data still conveyed as `sr-only` text rather
than hidden. `robots.txt` and `sitemap.xml` (both 404s) now exist, and each route has its
own title and description. Detail and raw numbers:
`jobs/tier1-gate-fixes/evidence/gate-fixes.md`.

A fourth pass — a **takeover** of the two subagent runs left working, rather than waiting on
them — re-verified the design-QA verdict (including refuting its pin hit-area "defect": the
leaves measure 24.5 × 24.5 across 12/12 and the old 23 × 24 was the probe's own artefact, so
no CSS changed) and closed two of its nits: the header's explorer links were bare paths, so
navigating by header silently dropped `?score=`/`?min_dom=` and reset the cohort 43 → 133 while
`/trends` claims *"Reflects the current map filters"*; and `/trends` claimed *"0 listings shown"*
while its first fetch was in flight — a *failed* fetch claimed zero too, so the error path now
says so. The same pass root-caused a **pre-existing** CLS breach the gate never measured: the
`Freshness` strip is 78 px loading, 118 px live and ~464 px with its detail line and frozen pill,
but the header's first row leaves it 135 px at 390 — so a frozen `live:false` fallback wrapped
the row and pushed `<main>` down 28 px for **0.1466**, and the detail line wrapped the row from
640–830 for **0.317** in the *normal* path (the deployed pre-fix build scores 0.31728, so not
new, but invisible because the CLS cells are 390/1280/1350). All three fixed: below `lg` the
frozen state folds into one date-carrying pill, the wrapper is `max-w-[130px] truncate` so it
can never reflow that row again, and the detail line shows from 1024 px up — the first breakpoint
above the band. Measured on the deployment: **0.00190** and **0.00119 / 0.00099**, with CLS
12/12 and axe 0/0 unchanged. Disclosed trade: between 640 and 1023 px the header no longer shows
the tracked/High/source detail. Detail: `jobs/tier1-gate-fixes/evidence/gate-fixes.md` § 11.

- **The SQL migration and the `vw_listing_history` grant are applied** (production
  Neon, 2026-10-16 ~13:55Z), so the price-history panel reads real data:
  `vw_listing_history` holds 1,093 rows, 74 listings carry a second snapshot, and
  `/api/listing/145558321` returns `live:true` with a two-point series. Apply
  order, post-apply figures, and the two hazards that make the order matter:
  `docs/apply_tier1_migration.md`
- What was built, decided and left open: `docs/roadmap.md` § "Build status — Tier 1"
- Prove the migration against a real local PostgreSQL before touching production:
  `scripts/tier1_migration_check.ps1` (apply order, idempotency, the upgrade guard,
  the grant hazard, the cold-start gate, the history view vs the shipped query)
- Test count is now **220 passed** (`python -m pytest -q`, re-verified
  2026-10-25); `dashboard/verify_contract.py` 54/54; `ruff check
  src scripts tests dashboard` and `mypy src` both clean — the two static gates
  `checks.yml` now runs before the tests. The DataImpulse-credential
  tests run when `config/dataimpulse.local.env` is present and skip without it.

#### Deploy mechanics

**A `git push` to `main` deploys production.** The Vercel GitHub App is installed on
`Frappppy/off-market-radar-nyc` and the project is connected to it. Read that connection
from the **API**, not the CLI — `vercel project inspect --json` omits `link` entirely and
will report an unconnected project that is in fact connected:

```bash
GET /v9/projects/prj_lZtIBrfxq0TehcMulRyjF4ijQifY?teamId=team_WNXfrRLYe1daExSxWFgXIteV
# -> link.type=github, link.repo=off-market-radar-nyc, link.productionBranch=main
```

Current state: `link.type=github`, `link.org=Frappppy`, `link.repo=off-market-radar-nyc`,
`link.repoId=1421686985`, `link.productionBranch=main`, `link.deployHooks=0`,
`rootDirectory=site`, `framework=nextjs`.

Pushing `3495fea` (an empty commit, no file changes) produced
`dpl_9wcKJJhChPefgAfgKrXYa4Xwt478` — `READY`, `target=production`, seven seconds later,
with no CLI command run — and the production alias moved to it
(`off-market-radar-nyc.vercel.app` → `off-market-radar-80u84hga7-…`). It was not a
one-off: two later documentation pushes did the same (`cc67efa` →
`dpl_W2PBmfwxHLaYdWE91D8w8YANrFbv`; `2537149` → alias `off-market-radar-lgu4qd0ll-…`).
Branches build **Preview** deployments as well: a branch pushed with its own commit
(`5acf286`, `3c0d9b5`) produced a `target=preview` deployment that reached `READY` in ~50 s.

Two things about previews that are easy to get wrong. **They are not publicly
reachable.** The project runs Vercel Authentication
(`ssoProtection: {deploymentType: "all_except_custom_domains"}`; `passwordProtection` is
unset, `gitForkProtection` is `true`), so an anonymous fetch of a preview URL gets
`302 → https://vercel.com/sso-api?url=…` while the production alias returns `200` in the
same breath — previews are for people signed in to the team, not links to hand a client.
And **deleting a deployment mid-build is reported as a failed build**: cleaning up a
preview while it was still `BUILDING` produced a "Preview deployment failed — Deployment
not found. Was it deleted?" email, because Vercel recorded the cancellation as the build's
outcome. Let a preview reach `READY` before removing it, or expect that email.

**How to tell a push-triggered build from a CLI one — `sha` and `branch` are not it.**
An earlier version of this section claimed the two were *"dashboard-indistinguishable"*.
They are not: the discriminator simply isn't where you would look. The CLI stamps the local
git branch, SHA and message onto whatever it uploads, so the **shared** keys —
`githubCommitSha`, `githubCommitRef`, `githubCommitRepo`, `githubCommitOrg`, `githubOrg`,
`githubRepo`, `githubDeployment`, `githubCommitMessage`, `githubCommitAuthorEmail`,
`githubCommitAuthorName`, `lambdaRuntimeStats` — prove nothing either way. What actually
separates them:

| | push (App) | CLI (`vercel deploy`) |
|---|---|---|
| top-level `source` | `git` | `cli` |
| `meta` keys present **only** here | `branchAlias`, `githubCommitAuthorLogin`, `githubCommitRepoId`, `githubCommitVerification`, `githubHost`, `githubRepoId`, `githubRepoOwnerType`, `githubRepoVisibility`, `repoPushedAt` | `actor`, `gitDirty`, `gitRootDirectory` |

Observed on this project: the CLI deployment `dpl_FuzAiwPgnQTjorvhaRPVWgw4839f` carries
`actor=opencode`, `gitDirty=1`, `gitRootDirectory=site`; the push-triggered
`dpl_9wcKJJhChPefgAfgKrXYa4Xwt478` carries
`branchAlias=off-market-radar-nyc-git-main-frappppy.vercel.app`, `githubHost=github.com`,
`githubRepoVisibility=public`. `branchAlias` is the per-branch hostname a git deployment
also gets; a CLI upload does not carry the key at all.

**A preview is skipped for an already-built commit.** A branch pushed at a SHA that has
already been deployed — e.g. a branch cut from the tip of `main` — produces **no**
deployment, by design (observed: branch `pipeline-preview-test` at `3495fea`, nothing in
3.5 minutes). If a preview looks missing, check the SHA before suspecting the integration,
then give the branch its own commit and it builds.

**Do not use `hooks: []` as the test for any of this.** It was used that way during the
period described below, and it is wrong in both directions: a GitHub App integration
delivers events through its own installation webhook, not through per-repo webhooks, so
`gh api repos/…/hooks` can be `[]` while an App is installed. (This token cannot read
installations to settle it — `/user/installations` returns 403 and
`/repos/…/installation` requires App authentication.) The only reliable confirmation is a
**push that produces a deployment**, which is what settled the question in both directions.

The project's Root Directory was `.`, which was wrong: the Next.js app lives in
`site/` and the repo root holds no `package.json`, so any Git-triggered build
would have failed immediately. It is now `site` (`vercel project update
--root-directory site` → `"changed": true`; `vercel project inspect` reports
`Root Directory  site`).

**The CLI remains the escape hatch**, and its interaction with `Root Directory` has one
sharp edge worth writing down. Vercel resolves `Root Directory` **relative to whatever
directory is uploaded**, so running the CLI from inside `site/` makes it look for
`site/site` and fail with `The specified Root Directory "site" does not exist`.
Deploy from the **repo root** instead:

```bash
vercel deploy --prod --yes --project off-market-radar-nyc   # run from the repo root
```

Two traps in that interaction, both hit and both still worth knowing. A deploy with
`--prod` is a **production** deployment, so if it fails, Vercel emails "production
deployment failed": here that email came from a 475 ms config rejection of a deploy
attempted from the wrong directory, not from a broken push. And because the CLI stamps
the local git branch, commit SHA and commit message onto whatever it uploads, that failed
deploy reads "on branch main at commit …" in the dashboard — which is exactly why the top
level `source` field, not the SHA, is the thing to check (see the table above). Check
`duration` as well: sub-second means a config rejection, not a build. To deploy without
touching production or triggering that email, drop `--prod`.

**History — how this was unwired until 2026-10-17.** Pushing `de0f291` (74 files) to
`main` while watching the deployment list created **no deployment at all**: the newest
stayed `f1wxct749` and no GitHub deployment record appeared. `vercel git connect` failed
with `Failed to connect Frappppy/off-market-radar-nyc to project` while the repo is public
(`gh repo view --json visibility` → `PUBLIC`), which ruled out private-repo access and
pointed at the missing App — the actual cause. Two ordering lessons from that period are
still worth keeping if the connection is ever redone: **connect only after the intended
code is already pushed**, because connecting can itself trigger a build of the newest
commit and would rebuild the previous commit over production; and **do not assume
push-to-deploy works before the App is installed**, because a push that ships source
without deploying looks identical from the outside.

### Live data reality — what the website actually shows

The Vercel site reads Neon and the freshness strip reports `live: true`. "Live"
describes the **plumbing**; this section describes the **coverage**, because the
two are not the same thing.

As of 2026-10-25 the database holds **five** successful runs (see `pipeline_runs`),
including a one-off **full-market harvest** and a daily run after it:

| run_id | records | how it got there |
|---|---|---|
| `neon-prod-load-20261016` | 82 | manual load of the 2-page smoke scrape |
| `20261016-055515` | 1,011 | scheduled `daily_pipeline` (30 pages / 120 details) |
| `20261020-145403` | 989 | scheduled `daily_pipeline` |
| `full-harvest-20261023` | 22,317 | one-off full harvest, 177 ZIP shards, 22,577 raw → 22,317 after the clean-stage guard |
| `20261024-135546` | 1,017 | scheduled `daily_pipeline` — back to the 150-request budget |

**Read these two numbers separately, because the site does.**

| | value | where it comes from |
|---|---|---|
| Ledger — every listing ever ingested | **22,492** (22,420 active) | `listings` / `vw_latest_listings` |
| Newest daily cohort — what the header and hero show | **1,017** (2026-10-24) | `vw_latest_listings` filtered to `max(snapshot_date)` |

The harvest did not disappear; the daily cron simply overwrote the *newest*
snapshot with a 1,017-row cohort the next day. `/api/meta` therefore returns
`total_tracked: 1,017`, `high_count: 76` and `total_ever_tracked: 22,492` — the
design from commit `5267434` ("show today's cohort beside the total ledger"), and
the reason every surface labels the first figure "tracked today".

Current dataset, read through the read-only role's granted views:

- **22,492 rows** in `vw_latest_listings`; the **2026-10-23** snapshot holds
  **22,317** of them — **97.9%** of the ~22.8k active NYC listings Zillow reported
  on 2026-10-15, and the only whole-market point in the series.
- **5 snapshot dates** (2026-10-15/16/20/23/24), **25,416** rows in
  `listing_snapshots`, **699 (zip, date) rows** in `vw_zip_price_drop_30d`, and
  **~29 MB** total. Only 2026-10-23 is market-wide, so the 30-day trend view has
  one meaningful point per ZIP until the harvest is repeated.
- Score mix across the ledger: **1,848 High / 8,746 Medium / 11,898 Low**. The
  harvest Parquet alone is 1,844 / 8,731 / 11,742; the view adds the 135 rows from
  earlier daily runs that have not yet missed `STALE_RUNS = 3` runs.
- **7,058 of the 22,317 harvest rows carry `price_drop_pct`** (31.6%), 17,535
  carry `$ / sqft`, 22,207 carry coordinates. Price history comes from the listing
  page, so a search-only harvest only sees cuts Zillow had already flagged —
  **the High count is a floor, not a ceiling**, because a missing drop can never
  score High (`src/clean/score.py` treats null as ≤ 5%).

Known limits, stated plainly:

- The frozen CSV fallback (`site/public/data/listings_sample.csv`) is still the
  82-row smoke sample, byte-identical to `jobs/smoke-scrape-20261015-084632`. It
  renders only when Neon is unreachable, and it is **not** the live dataset — so
  a fallback render legitimately looks smaller than the live site.
- The 97.9% figure is a **one-off**, not the steady state — the very next daily
  run took the newest cohort back to 1,017. `scripts/run_daily.py` still spends
  150 requests per day. Repeating the harvest is a manual, explicitly approved
  action (`python -m src.scrape.harvest`, resumable ledger under
  `jobs/full-harvest-20261023/`), deliberately **not** wired into the cron.
- **Detail enrichment is still skipped.** The harvest ran the search pass only
  (`--details none`), which is why 68% of rows have no `price_drop_pct`. Running
  `--details motivated` against the same ledger is the cheapest way to raise the
  High count without a single extra search request.

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

## License

MIT ( [`LICENSE`](LICENSE) ) — copyright 2026 Oyshik Mahmud. It covers **this
repository's code**: the pipeline, the SQL, the Next.js site, the tests.

What it deliberately does not grant:

- **No rights to the data.** Listing records come from Zillow under the access
  rules in *Compliance & ethics* above; the license says nothing about
  republishing them, and `jobs/` evidence and the bundled CSV are data, not
  licensed software.
- **No rights to third-party marks or services** — Zillow, Power BI, Vercel,
  Neon, DataImpulse, MapLibre/Carto basemap tiles keep their own terms.
- **No implied permission to run the scraper.** `--pages`, pacing and the
  abort-on-CAPTCHA rule are the author's compliance choices for a portfolio
  project; copying the code does not copy that judgement onto your traffic.

If you want this under a different or no license, that is a one-file change —
say so before it is published anywhere.

*Honest gaps noted as they arise: see each stage's process log under `jobs/`
and `dashboard/build_guide.md` Step 10 for GUI steps that can't be verified
headlessly (Power BI visuals, Neon live connection). Known open gaps are
tracked in [ARCHITECTURE.md](ARCHITECTURE.md) §6 (unpinned invariants) and
[REPO_MAP.md](REPO_MAP.md) §9–§10 (historical baseline).*
