# Deploying the daily pipeline (GitHub Actions + Neon)

The pipeline runs every day at **10:00 UTC** via `.github/workflows/daily_pipeline.yml`
(plus manual runs through *Actions → daily_pipeline → Run workflow*).

This document covers the daily **data pipeline** only; the website itself (`site/`)
is a separate Vercel project that deploys automatically on a push to `main` (see
`README.md` § Deploy mechanics).

Secrets only ever live in GitHub's encrypted secret store / your gitignored local
`config/*.local.env`. **They never go in any file in this repository** — no YAML
values, no scripts, no docs.

## 1. Create the database (Neon)

1. Create a free account at <https://neon.tech> and a new project (region: US East
   is a good default for US listings).
2. In the Neon console, open **Connection string** and copy the PostgreSQL URI.
3. Make sure it ends with `sslmode=require`, e.g.
   `postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require`.
4. Apply the schema once: paste the contents of `sql/schema.sql` into Neon's
   **SQL Editor** and run it. (`src.store` also re-applies it idempotently on every
   run as a safety net.)

## 2. Create the GitHub repository

```bash
git init
git add -A
git commit -m "Project 1: off-market deal finder pipeline"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Nothing secret is committed: `config/*.local.env`, `.env*`, and `jobs/*/raw|cleaned`
are all in `.gitignore`.

## 3. Add the secrets (Settings → Secrets and variables → Actions → New repository secret)

Create **exactly these six** secrets:

| Secret | Value | Used by |
|---|---|---|
| `DATABASE_URL` | Neon connection string with `sslmode=require` | Stage 3 `src.store` |
| `DATAIMPULSE_LOGIN` | DataImpulse proxy username | Stage 1 `src.scrape` |
| `DATAIMPULSE_PASSWORD` | DataImpulse proxy password | Stage 1 `src.scrape` |
| `DATAIMPULSE_HOST` | e.g. `gw.dataimpulse.com` | Stage 1 `src.scrape` |
| `DATAIMPULSE_PORT` | e.g. `823` | Stage 1 `src.scrape` |
| `DATAIMPULSE_COUNTRY` | e.g. `US` | **not read by the pipeline** — stage 1 fixes the exit country itself (`{login}__cr.us` in `src/scrape/proxy.py`); the secret exists only because the workflow's six are frozen by `tests/test_workflow_yaml.py` |

The workflow injects them as environment variables (`${{ secrets.NAME }}` only —
the file contains no values). Locally you would instead fill
`config/database.local.env` and `config/dataimpulse.local.env` (both gitignored).

## 4. Run it

- **Manual test:** *Actions → daily_pipeline → Run workflow*.
- **Automatic:** cron `0 10 * * *` (10:00 UTC daily).
- Each run writes `jobs/<run_id>/run_log.md` plus per-stage
  `manifest.json` / `process_log.md`; results are visible in Postgres
  (`pipeline_runs` table: `running` → `success` / `failed`).
- To iterate without re-scraping (from the project folder): `..\.venv\Scripts\python.exe scripts\run_daily.py --skip-scrape`.

## Security notes

- Rotate the Neon password and DataImpulse credentials if they ever appear in a
  commit, an issue, or a log.
- Workflow logs never print `DATABASE_URL` or proxy passwords (the store stage
  logs "target: DATABASE_URL (value never logged)").
- GitHub Actions secrets are masked in logs, but do not rely on masking — keep
  secrets out of files in the first place.
