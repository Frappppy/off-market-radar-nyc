"""WHAT:      Interpretation rules over parsed Zillow blobs — the property-type
           enum (``PROPERTY_TYPES``, ``normalize_property_type``), the
           price-history labels (``parse_price_history``, ``_derive_event``),
           the JSON-string blob unwrapper (``_as_dict``) and the price-cut
           amount helpers.
WHY:        These are the "interpret what the site said" rules, distinct from
           raw extraction (``extract.py``) and from the final row assembly
           (``record.py``); keeping them together makes the co-op/enum rule and
           the derived-event anchors reviewable in one screen.
INPUTS:     Parsed ``entry`` (search card) / ``prop`` (detail) / JSON-LD dicts.
OUTPUTS:    Contract enum ``str``; ``[{date, price, event}]`` rows or ``None``;
            signed cut ``int`` / stated cut amount or ``None``; unwrapped dict.
CALLERS:    ``src.scrape.parsing.extract`` (``_as_dict``, ``normalize_property_type``),
            ``.record`` (the rest); ``parsing/__init__`` re-exports
            ``PROPERTY_TYPES`` + ``normalize_property_type``. Split verbatim
            from the pre-phase-2 ``src/scrape/parsers.py``.
TESTED BY:  ``tests/test_scrape.py::test_contract_enum_exhaustive``,
            ``::test_normalize_property_type`` (11-case matrix),
            ``::test_detail_overrides_search_and_derives_price_fields``
            (price-history events, incl. the null).
"""

import json
import re

from .coerce import as_int, ms_to_date
from .text import parse_dollar_amount

#: docs/data_contract.md — property_type enum (co-op matters in NYC). Verified by: test_contract_enum_exhaustive
PROPERTY_TYPES = (
    "house",
    "condo",
    "co-op",
    "townhouse",
    "multi-family",
    "land",
    "other",
)


# --- property_type normalization -------------------------------------------

def _norm_token(value):
    return re.sub(r"[\s_\-]+", "", str(value)).lower()


#: ordered (needle, contract-enum) rules — evaluated on a whitespace-stripped
#: lowercase token, so "Multi-family home for sale" and "MULTI_FAMILY" both hit.
#: Verified by: test_normalize_property_type
_TYPE_RULES = (
    ("coop", "co-op"),          # Cooperative / Coop / Co-op (NYC co-ops!)
    ("multifamily", "multi-family"),
    ("twofamily", "multi-family"),
    ("threefamily", "multi-family"),
    ("townhouse", "townhouse"),
    ("townhome", "townhouse"),
    ("rowhouse", "townhouse"),
    ("house", "house"),          # after townhouse/rowhouse: those contain "house"
    ("singlefamily", "house"),
    ("condo", "condo"),
    ("condominium", "condo"),
    ("apartment", "condo"),
    ("vacantland", "land"),
    ("unimprovedland", "land"),
    ("lotland", "land"),
    ("land", "land"),
    ("manufactured", "other"),
    ("mobile", "other"),
)


def normalize_property_type(*candidates):
    """Map Zillow type tokens (detail resoFacts first) to the contract enum.

    ``candidates`` are tried in order; the first one that matches wins.
    Falls back to ``"other"``.
    """
    for candidate in candidates:
        if not candidate:
            continue
        if isinstance(candidate, (list, tuple)):
            for item in candidate:
                resolved = normalize_property_type(item)
                if resolved != "other":
                    return resolved
            continue
        token = _norm_token(candidate)
        for needle, contract_type in _TYPE_RULES:
            if needle in token:
                return contract_type
    return "other"


# --- price history ----------------------------------------------------------

def _derive_event(date, price, newest_date, prop, current_price):
    """Label one price-history row. The embedded ``priceHistory`` usually
    carries only ``{date, price}``; labels come strictly from verifiable
    anchors on the same record (most recent cut, last sale, current price)
    and stay ``null`` when no anchor matches — never invented.
    Verified by: test_detail_overrides_search_and_derives_price_fields"""
    price_change = as_int(prop.get("priceChange"))
    change_date = prop.get("priceChangeDateString")
    if price_change is not None and price_change < 0 and change_date:
        if str(date) == str(change_date) and (
            current_price is None
            or price is None
            # the row shows the post-cut price; accept pre-cut storage too
            or price in (current_price, current_price - price_change)
        ):
            return "Price change"
    sold_date = ms_to_date(prop.get("dateSold"))
    if sold_date and str(date) == sold_date:
        return "Sold"
    if (
        newest_date is not None
        and str(date) == str(newest_date)
        and price is not None
        and current_price is not None
        and price == current_price
    ):
        return "Listed for sale"
    return None


def parse_price_history(prop):
    """`[{date, price, event}]` rows (contract shape) or None."""
    if not prop:
        return None
    raw = prop.get("priceHistory")
    if not isinstance(raw, list) or not raw:
        return None
    current_price = as_int(prop.get("price"))
    dates = [str(row.get("date")) for row in raw if isinstance(row, dict) and row.get("date")]
    newest_date = max(dates) if dates else None
    rows = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        date = row.get("date")
        price = as_int(row.get("price"))
        if date is None and price is None:
            continue
        if isinstance(row.get("event"), str) and row["event"]:
            event = row["event"]  # future-proof: take source label if present
        else:
            event = _derive_event(date, price, newest_date, prop, current_price)
        rows.append(
            {
                "date": str(date) if date is not None else None,
                "price": price,
                "event": event,
            }
        )
    return rows or None

# --- search-card / detail price-cut helpers --------------------------------

def _as_dict(value):
    """Nested blobs are sometimes JSON strings; unwrap once.
    Verified by: test_extract_detail_property_unwraps_stringified_cache"""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


def _search_home_info(entry):
    if not entry:
        return {}
    hdp = entry.get("hdpData")
    if isinstance(hdp, str):
        hdp = _as_dict(hdp)
    info = ((hdp or {}).get("homeInfo")) if isinstance(hdp, dict) else None
    return info if isinstance(info, dict) else {}


def _search_price_change(entry):
    info = _search_home_info(entry)
    for source in (info.get("priceChange"), info.get("priceReduction")):
        if source is None:
            continue
        if isinstance(source, str):
            amount = parse_dollar_amount(source)
            if amount:
                return -amount
            continue
        number = as_int(source)
        if number is not None and number < 0:
            return number
    return None


def _detail_price_change(prop):
    if not prop:
        return None
    number = as_int(prop.get("priceChange"))
    return number if number is not None and number < 0 else None
