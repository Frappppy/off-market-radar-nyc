# Robots pre-check — Project 1 (recorded 2026-10-14)

Required by the data-scraping rules: robots.txt fetched and analyzed BEFORE the
first request. `bin/oc-robots.ps1` does not exist on this machine, so each file
was fetched manually; full snapshots saved under `jobs/robots/`.

| Domain | Snapshot | Verdict |
|---|---|---|
| zillow.com | `jobs/robots/zillow.com_robots.txt` | **USABLE for this project.** `User-agent: *` explicitly `Allow:`es `/homes/for_sale/$` and paginated `*_p/$` variants; `/homedetails/*` detail pages have no blanket disallow (only owner-view / rental-manager subpaths). `/api/`, `/graphql/`, `/search/HDPMapResults.htm` are disallowed — never request them. |
| realtor.com | `jobs/robots/realtor.com_robots.txt` | **EXCLUDED.** File opens with an explicit legal notice: scraping is "unauthorized without the express written permission from Move Sales, Inc." Not a target for any stage of this project. |
| redfin.com | `jobs/robots/redfin.com_CHALLENGE_page.html` | **Backup only, browser-level.** Full robots.txt fetched during pre-check (regular city/listing pages have no blanket generic-UA disallow; internal `/stingray/` API disallowed). Direct curl of even robots.txt returns an "Are You a Robot?" challenge page (saved as evidence), so Redfin would require a stealth browser if ever used. |

Probe (single GET, permitted path): `https://www.zillow.com/phoenix-yn/` →
returned full server-rendered listing content, no CAPTCHA.
(A live NYC probe is run by the scrape stage on `new-york-ny`.)

## Proxy verification (recorded 2026-10-14)
- Raw login (no geo param) `@gw.dataimpulse.com:823` → exit **Italy** `151.74.186.123` — unusable for geo.
- `{login}__cr.us:…@gw.dataimpulse.com:823` → exit **New York, United States** `92.113.223.155` ✓ (verified via ip-api.com).
- Credentials live only in `config/dataimpulse.local.env` (gitignored). Never logged or committed.

## Operating limits for every run
- Only robots-allowed paths (search pages + homedetails) on zillow.com.
- DataImpulse residential proxy, US exit; honor 429/Retry-After. The contractual
  floor is 2s between requests (`MIN_DELAY` in `src/scrape/cli.py`); the daily job
  runs at **5s** (`DAILY_DELAY` in `scripts/run_daily.py`).
- Portfolio volume — single source of truth is `scripts/run_daily.py`
  (`DAILY_PAGES` / `DAILY_MAX_DETAILS`): **30 search pages + 120 detail pages**
  per daily run (~150 requests, the same load the original 5-page/150-detail
  default carried). A search page costs one request for ~41 listings; a detail
  page costs one request for one listing — so pages are spent on coverage
  (roughly 5% of Zillow's ~22.8k NYC actives) and the detail budget is aimed at
  the most promising rows. A deliberate ceiling, not a full-market scrape.
  Override per run with `--pages` / `--max-details` / `--delay`.
- If a PerimeterX/CAPTCHA challenge appears: STOP the run and report to the user.
  Do not attempt to defeat CAPTCHA.
  - **Observed 2026-10-16:** a challenge (HTTP 403) was served on the *very first*
    search request, ~1 minute after a single permitted probe succeeded (41
    records). The run aborted with `status: failed`, wrote 0 records, and left
    stages 2-3 skipped — see `jobs/full-scrape-20261016b/run_log.md`. Two
    consecutive attempts behaved identically. The stop rule fired correctly; no
    retry-until-it-passes logic exists anywhere in the pipeline by design.
  - **Same day, ~30 minutes later:** the scheduled `daily_pipeline` run, through
    the *same* proxy pool at the same pacing, completed all ~150 requests and
    stored **1,011 listings** (`pipeline_runs.run_id = 20261016-055515`). So the
    block was transient pool reputation, not our request volume (it failed on
    request #1, before volume could matter) and not a permanent wall. The
    unconditional stop rule is unchanged and still has no bypass.
