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
- DataImpulse residential proxy, US exit; ≥2s between requests; honor 429/Retry-After.
- Portfolio volume: page cap per run (default 5 search pages) + detail-page cap (default 150/run).
- If a PerimeterX/CAPTCHA challenge appears: STOP the run and report to the user.
  Do not attempt to defeat CAPTCHA.
