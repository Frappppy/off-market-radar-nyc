"""WHAT:      Public parsing surface for stage 1 — the pre-phase-2
           ``src.scrape.parsers`` (643 lines) split into focused modules:
           ``coerce`` (null-safe scalars), ``text`` (rendered-text scrapers),
           ``derive`` (interpretation rules), ``extract`` (embedded-JSON
           extraction) and ``record`` (row assembly).
WHY:        One file per concern keeps every rule reviewable in one screen;
           this package re-exports every former public name so callers see an
           unchanged API surface — there is deliberately NO ``parsers.py``
           shim left behind (REFACTOR_PLAN phase 2).
INPUTS:     See each submodule; this file only re-exports.
OUTPUTS:    ``BASE_URL``, ``PROPERTY_TYPES``, ``SearchPage``, ``as_float``,
           ``as_int``, ``build_record``, ``extract_detail_property``,
           ``extract_json_ld``, ``extract_next_data``, ``ms_to_date``,
           ``normalize_property_type``, ``parse_days_on_zillow_text``,
           ``parse_dollar_amount``, ``parse_price_history``,
           ``parse_price_cut_text``, ``parse_search_page``,
           ``price_cut_flag_in_html`` — identical names to the old module.
CALLERS:    ``src.scrape.phases`` (via this package), ``tests/test_scrape.py``.
TESTED BY:  ``tests/test_scrape.py`` exercises every name above.
"""

from .coerce import as_float, as_int, ms_to_date
from .derive import PROPERTY_TYPES, normalize_property_type, parse_price_history
from .extract import (
    BASE_URL,
    SearchPage,
    extract_detail_property,
    extract_json_ld,
    extract_next_data,
    parse_search_page,
)
from .record import build_record
from .text import (
    parse_dollar_amount,
    parse_days_on_zillow_text,
    parse_price_cut_text,
    price_cut_flag_in_html,
)

__all__ = [
    "BASE_URL",
    "PROPERTY_TYPES",
    "SearchPage",
    "as_float",
    "as_int",
    "build_record",
    "extract_detail_property",
    "extract_json_ld",
    "extract_next_data",
    "ms_to_date",
    "normalize_property_type",
    "parse_dollar_amount",
    "parse_days_on_zillow_text",
    "parse_price_cut_text",
    "parse_price_history",
    "parse_search_page",
    "price_cut_flag_in_html",
]
