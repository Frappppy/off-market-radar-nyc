"""WHAT:      Text/regex scrapers for Zillow's own display strings — the
           "Price cut" HTML flag, the ``$``/days-on-Zillow text parsers, and
           the stated-cut-amount helper (``_site_cut_amount``).
WHY:        These are the only rules that read *rendered text* instead of
           embedded JSON (the page's own price-cut disclosure), so they sit
           apart from the JSON extractors; one regex set, one place to retune
           when Zillow rewords a label.
INPUTS:     An HTML fragment / page (may be ``None``) or a display string;
           ``_site_cut_amount`` takes the parsed search ``entry`` / detail
           ``prop`` dicts too.
OUTPUTS:    ``bool`` for the HTML flag; ``int`` cut amount / day-count or ``None``.
CALLERS:    ``src.scrape.parsing.record`` (flag + stated cut + days-on-market);
            ``parsing/__init__`` re-exports the public four. Split verbatim
            from the pre-phase-2 ``src/scrape/parsers.py`` (the dead
            ``head = html[: len(html)]`` no-op was dropped per REPO_MAP §8.1).
TESTED BY:  ``tests/test_scrape.py::test_price_cut_and_days_text_parsers``;
            ``price_cut_flag_in_html`` via
            ``::test_detail_overrides_search_and_derives_price_fields``.
"""

import re

from .coerce import _first, as_int

_PRICE_CUT_TEXT_RE = re.compile(r"Price cut\s*:", re.IGNORECASE)
_FLEX_PRICE_CUT_RE = re.compile(r"Price cut:\s*\$\s*([\d,]+)")
_DOLLAR_AMOUNT_RE = re.compile(r"\$\s*([\d,]+)")
_DAYS_TEXT_RE = re.compile(r"(\d+)\s+days?\s+on\s+Zillow", re.IGNORECASE)


def price_cut_flag_in_html(html):
    """True when the server-rendered page shows Zillow's own "Price cut" tag."""
    if not html:
        return False
    return bool(_PRICE_CUT_TEXT_RE.search(html)) or "price-change-tag" in html


# --- field helpers ----------------------------------------------------------

def parse_price_cut_text(text):
    """``"Price cut: $15,000 (10/6)"`` -> 15000 (site-stated cut amount)."""
    if not text:
        return None
    match = _FLEX_PRICE_CUT_RE.search(text)
    if not match:
        return None
    return as_int(match.group(1).replace(",", ""))


def parse_dollar_amount(text):
    if not text:
        return None
    match = _DOLLAR_AMOUNT_RE.search(text)
    if not match:
        return None
    return as_int(match.group(1).replace(",", ""))


def parse_days_on_zillow_text(text):
    if not text:
        return None
    match = _DAYS_TEXT_RE.search(text)
    return as_int(match.group(1)) if match else None


def _site_cut_amount(entry, prop):
    """Stated cut amount from the search card / detail record, else None."""
    if entry:
        amount = parse_price_cut_text(entry.get("flexFieldText"))
        if amount:
            return amount
    if prop:
        text = _first(prop.get("priceReduction"), "")
        amount = parse_dollar_amount(text if isinstance(text, str) else None)
        if amount:
            return amount
    return None
