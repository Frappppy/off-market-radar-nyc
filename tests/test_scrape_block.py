"""WHAT:      Stage-1 block detection at HTTP 403 — a complete page payload is
           data, not a challenge; a PerimeterX marker aborts at any status.
WHY:       Invariant I11's stop rule ("CAPTCHA = hard stop") was being fired by
           the *status code alone*, and Zillow serves 403 with a full
           `__NEXT_DATA__` body: that one rule aborted 7 of 10 scheduled harvest
           runs while the manual harvest path read the same pages for two days.
           Split out of tests/test_scrape.py on 2026-10-25 when the parent
           passed the 300-line hard cap (docs/decisions.md §7).
INPUTS:    src.scrape.http.looks_like_block + the offline page fixtures in
           tests/fixtures/zillow_pages.py. No network, no credentials.
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
Verified by: test_403_with_payload_is_not_a_block, test_403_challenge_page_is_still_a_block,
           test_403_with_no_payload_is_a_block — one per arm of the rule.
"""

from src.scrape.http import looks_like_block
from tests.fixtures.zillow_pages import PX_PAGE, detail_html, search_html


def test_403_with_payload_is_not_a_block():
    """Zillow serves 403 + complete body (jobs/harvest-probe/, 2026-10-23).

    This is the rule that failed 7 of 10 scheduled runs: the curl_cffi path
    aborted on the status while the harvest path had been reading the payload
    for two days. Data we may keep is not a challenge.
    """
    assert looks_like_block(403, search_html()) is False
    assert looks_like_block(403, detail_html()) is False
    assert looks_like_block(403, search_html(), expect="search") is False
    assert looks_like_block(403, detail_html(), expect="detail") is False


def test_403_challenge_page_is_still_a_block():
    """A PX marker aborts at every status — even on a page that also carries a
    payload. Detection got more accurate, not more permissive."""
    assert looks_like_block(403, PX_PAGE) is True
    challenged = '<meta name="description" content="px-captcha">' + search_html()
    assert looks_like_block(403, challenged) is True


def test_403_with_no_payload_is_a_block():
    assert looks_like_block(403, "<html>denied</html>") is True
    assert looks_like_block(403, "") is True
