# Daily pipeline — run `20261014-000001`

- started_at: 2026-10-14T16:01:04+00:00
- interpreter: `C:\Users\omisg\AppData\Local\Python\pythoncore-3.14-64\python.exe`
- python: 3.14.4
- repo: `D:\Code\porfolio_project\Web Scraping`

## Stage 1: scrape
- SKIPPED: --skip-scrape (reusing jobs/20261014-000001/raw)

## Stage 2: clean
- command: `C:\Users\omisg\AppData\Local\Python\pythoncore-3.14-64\python.exe -m src.clean --in jobs/20261014-000001/raw --out jobs/20261014-000001/cleaned`
- started_at: 2026-10-14T16:01:04+00:00

```text
C:\Users\omisg\AppData\Local\Python\pythoncore-3.14-64\python.exe: No module named src.clean.__main__; 'src.clean' is a package and cannot be directly executed
```
- finished_at: 2026-10-14T16:01:04+00:00
- exit code: 1

## Stage 3: store
- SKIPPED: earlier stage `clean` failed

## Summary

| stage | result |
|---|---|
| scrape | skipped (--skip-scrape (reusing jobs/20261014-000001/raw)) |
| clean | failed (exit 1) |
| store | skipped (earlier stage `clean` failed) |

- finished_at: 2026-10-14T16:01:04+00:00
- overall: failed (`clean`)
- log: `jobs/20261014-000001/run_log.md`
