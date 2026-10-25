"""WHAT:      Payload-presence block detection — ``page_payload_kind(html,
           expect)``, the single rule both stage-1 HTTP paths share.
WHY:        Zillow answers some requests with HTTP 403 *and* a complete
           server-rendered body (verified 2026-10-23, ``jobs/harvest-probe/
           evidence/findings.md``), so the status code is no longer a reliable
           block signal — the trustworthy one is "is the embedded JSON we came
           for actually in the document". The harvest path detected this since
           2026-10-23 while the curl_cffi path still aborted on every 403,
           which is what failed 7 of 10 scheduled runs; living in ``parsing/``
           (no Playwright import) both paths can use one rule.
           This makes detection *accurate*, not permissive: a page carrying a
           PerimeterX marker is still a block at any status (I11 unchanged).
INPUTS:     ``html`` — the response body; ``expect`` — ``"search"``,
           ``"detail"`` or ``None`` (either).
OUTPUTS:    ``"search"`` / ``"detail"`` when that payload parses, else ``None``.
CALLERS:    ``src.scrape.http.looks_like_block`` (curl_cffi path),
            ``src.scrape.browser`` (Playwright path),
            ``src.scrape.harvest``.
TESTED BY:  ``tests/test_harvest.py::test_payload_detection_search_and_detail``,
            ``tests/test_scrape.py::test_403_with_payload_is_not_a_block``,
            ``tests/test_scrape.py::test_403_challenge_page_is_still_a_block``.
"""

from __future__ import annotations

from .extract import extract_detail_property, parse_search_page


def page_payload_kind(html, expect=None):
    """``"search"`` / ``"detail"`` when the expected embedded JSON is usable,
    else ``None``. ``expect`` restricts the check to one kind."""
    if not html:
        return None
    if expect in (None, "search"):
        try:
            parsed = parse_search_page(html)
            if parsed.listings:
                return "search"
        except ValueError:
            pass
    if expect in (None, "detail"):
        if extract_detail_property(html) is not None:
            return "detail"
    return None
