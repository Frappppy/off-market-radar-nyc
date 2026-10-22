# src/scrape/parsing/ — pure extraction (split out of `parsers.py`, formerly a single 643-line file)

**What lives here.** All stage-1 parsing with **no I/O and no network** — fed
HTML in, contract records out:

| File | Owns |
|---|---|
| `coerce.py` | null-safe scalars: `as_int` / `as_float` / `ms_to_date` |
| `extract.py` | `__NEXT_DATA__` / JSON-LD extraction, search page, detail property |
| `record.py` | `build_record()` — the merge + **field precedence** (detail > search > JSON-LD) |
| `derive.py` | price history → events, property-type normalisation (18 rules), price-cut helpers |
| `text.py` | regex scrapers for rendered text (price cut, days, `$`) |

`__init__.py` re-exports the pre-phase-2 surface (`parse_search_page`,
`build_record`, …) so callers didn't change.

**The one trap.** Precedence lives **only** in `record.py` — a field appearing
in two sources is not a bug, the documented order decides. Don't "fix" it in a
caller.

**Detail.** Each file's T0 header. Tests: `tests/test_scrape.py` +
`tests/fixtures/zillow_pages.py` (synthetic pages; the old recorded dumps under
the gitignored `jobs/probe/` never existed in git).
