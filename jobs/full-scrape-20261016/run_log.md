# Daily pipeline - run `full-scrape-20261016`

- started_at: 2026-10-16T05:32:38+00:00
- interpreter: `D:\Code\porfolio_project\Web Scraping\.venv\Scripts\python.exe`
- python: 3.14.4
- repo: `D:\Code\porfolio_project\Web Scraping\Project 1 [The Off-Market Real Estate Deal Finder]`

## Stage 1: scrape
- command: `D:\Code\porfolio_project\Web Scraping\.venv\Scripts\python.exe -m src.scrape --pages 30 --max-details 250 --delay 5.0 --out jobs/full-scrape-20261016/raw`
- started_at: 2026-10-16T05:32:38+00:00

```text
scrape aborted: PerimeterX/CAPTCHA challenge (HTTP 403) on https://www.zillow.com/new-york-ny/
```
- finished_at: 2026-10-16T05:32:41+00:00
- exit code: 1

## Stage 2: clean
- SKIPPED: earlier stage `scrape` failed

## Stage 3: store
- SKIPPED: earlier stage `scrape` failed

## Summary

| stage | result |
|---|---|
| scrape | failed (exit 1) |
| clean | skipped (earlier stage `scrape` failed) |
| store | skipped (earlier stage `scrape` failed) |

- finished_at: 2026-10-16T05:32:41+00:00
- overall: failed (`scrape`)
- log: `jobs/full-scrape-20261016/run_log.md`
