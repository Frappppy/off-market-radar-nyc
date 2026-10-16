# Daily pipeline - run `20261014-161000`

- started_at: 2026-10-14T16:04:50+00:00
- interpreter: `D:\Code\porfolio_project\Web Scraping\.venv\Scripts\python.exe`
- python: 3.14.4
- repo: `D:\Code\porfolio_project\Web Scraping`

## Stage 1: scrape
- SKIPPED: --skip-scrape (reusing jobs/20261014-000001/raw)

## Stage 2: clean
- command: `D:\Code\porfolio_project\Web Scraping\.venv\Scripts\python.exe -m src.clean --in jobs/20261014-000001/raw --out jobs/20261014-161000/cleaned`
- started_at: 2026-10-14T16:04:50+00:00

```text
clean: skipped 1 malformed line(s), see jobs\20261014-161000\cleaned\process_log.md
clean: 0 records -> jobs\20261014-161000\cleaned\listings_2026-10-14.parquet (+ .csv, manifest.json, process_log.md)
```
- finished_at: 2026-10-14T16:04:51+00:00
- exit code: 0

## Stage 3: store
- command: `D:\Code\porfolio_project\Web Scraping\.venv\Scripts\python.exe -m src.store --in jobs/20261014-161000/cleaned`
- started_at: 2026-10-14T16:04:51+00:00

```text
src.store: ERROR: DATABASE_URL is not set.
  Provide it via the environment or config/database.local.env (gitignored).
  Format (see config/database.env.example):
    DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```
- finished_at: 2026-10-14T16:04:51+00:00
- exit code: 2

## Summary

| stage | result |
|---|---|
| scrape | skipped (--skip-scrape (reusing jobs/20261014-000001/raw)) |
| clean | success |
| store | failed (exit 2) |

- finished_at: 2026-10-14T16:04:51+00:00
- overall: failed (`store`)
- log: `jobs/20261014-161000/run_log.md`
