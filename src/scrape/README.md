# src/scrape/ — Stage 1: Zillow scraper (`python -m src.scrape`)

**What lives here.** Entry `__main__.py` → `cli.py` (argparse; `MIN_DELAY = 2.0`
floors `--delay`) → `run.py` (`ScrapeRun` state, guards, exit codes) →
`phases.py` (search phase follows `pagination.nextUrl`; detail phase enriches,
price-cut listings first) → `artifacts.py` (the four writers: `listings.jsonl`,
`pages_fetched.json`, `manifest.json`, `process_log.md` — always written, even
on failure). Support modules: `http.py` (curl_cffi client, pacing, 429/5xx
retry, CAPTCHA detection), `robots.py` (the compliance gate), `proxy.py`
(DataImpulse creds/URL/secret-scrubbing), `config.py` (constants only).
`parsing/` holds the split-out parsers.

**The one trap.** **Two robots gates run on purpose** — `robots.is_allowed_url()`
on every request *and* `run._guard_redirect()` on redirect targets. They are
deliberately not merged: the first rejects query strings (which would break
Zillow's legal `?`-carrying redirects), the second is the permissive
belt-and-braces. See [docs/decisions.md](../../docs/decisions.md) §2 before
touching either.

**Detail.** Each file's T0 header (the hard rules in `run.py`'s header name
their test anchors, or say "gap" where none exists). Contract:
[docs/data_contract.md](../../docs/data_contract.md); compliance limits:
[docs/robots_precheck.md](../../docs/robots_precheck.md).
