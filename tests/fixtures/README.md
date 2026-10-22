# tests/fixtures/ — test data

**What lives here.**

- `sample_raw.jsonl` — 10 raw records carrying all **20 contract keys**, plus
  the edge cases the suite needs: a drop of exactly 5.0 %, DOM exactly 91,
  missing keys, `sqft = 0`. Fed through the real clean stage in `test_clean.py`.
- `zillow_pages.py` — inline synthetic Zillow page HTML (search + detail
  shapes) used by `test_scrape.py`, with its own T0 header.

**The one trap.** These fixtures are **synthetic by decision**, not recorded
dumps: recordings would need real credentials/proxy state and would rot (the
old recorded `jobs/probe/*.html` files were gitignored scratch and are gone).
If a parser breaks on a new real page, add a *minimal synthetic* case here —
see the module header of `zillow_pages.py` for the WHY.
