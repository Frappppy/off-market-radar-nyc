"""WHAT:      Embedded-JSON extraction from server-rendered Zillow pages —
           ``__NEXT_DATA__``/JSON-LD blobs, the search-page parse
           (``SearchPage``), the detail ``property`` object, and the
           record-assembly field helpers that pull address / JSON-LD fields
           (incl. ``BASE_URL``).
WHY:        The pre-check probe proved every target page ships data as
           server-rendered JSON, so "embedded JSON -> parse it, always" is the
           whole extraction layer; it is kept separate from interpretation
           (``derive.py``) and row assembly (``record.py``).
INPUTS:     Raw HTML string (or ``None``) for the page extractors; parsed
           ``prop``/JSON-LD dicts for the field helpers.
OUTPUTS:    Parsed dict / ``SearchPage`` / ``property`` dict or ``None``;
            field dicts (``{}`` when absent).
CALLERS:    ``src.scrape.parsing.record``, ``src.scrape.phases`` (via
            ``parsing/__init__`` re-exports). Split verbatim from the
            pre-phase-2 ``src/scrape/parsers.py``.
TESTED BY:  ``tests/test_scrape.py::test_parse_search_page_extracts_cards_and_next_url``,
            ``::test_parse_search_page_without_embedded_json_raises``,
            ``::test_extract_detail_property_unwraps_stringified_cache``,
            ``::test_json_ld_only_detail_still_builds``.
"""

import json
import re

from .coerce import _first, as_float, as_int
from .derive import _as_dict, normalize_property_type

BASE_URL = "https://www.zillow.com"

# --- embedded-JSON extraction ----------------------------------------------

_NEXT_DATA_RE = re.compile(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*>(?P<json>.*?)</script>', re.DOTALL
)
_JSON_LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(?P<json>.*?)</script>', re.DOTALL
)


def extract_next_data(html):
    """``__NEXT_DATA__`` JSON object from a server-rendered page, else None."""
    if not html:
        return None
    match = _NEXT_DATA_RE.search(html)
    if not match:
        return None
    try:
        data = json.loads(match.group("json"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def extract_json_ld(html):
    """First JSON-LD object that looks like a RealEstateListing, else first dict."""
    if not html:
        return None
    fallback = None
    for match in _JSON_LD_RE.finditer(html):
        try:
            data = json.loads(match.group("json"))
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        if fallback is None:
            fallback = data
        declared = data.get("@type")
        types = declared if isinstance(declared, list) else [declared]
        if any(t == "RealEstateListing" for t in types if isinstance(t, str)):
            return data
    return fallback


# --- record-assembly field helpers -----------------------------------------

def _detail_address(prop):
    if not prop:
        return {}
    address = prop.get("address")
    address = address if isinstance(address, dict) else {}
    return {
        "street": _first(prop.get("streetAddress"), address.get("streetAddress")),
        "city": _first(prop.get("city"), address.get("city")),
        "state": _first(prop.get("state"), address.get("state")),
        "zip": _first(prop.get("zipcode"), address.get("zipcode"), address.get("postalCode")),
        "latitude": as_float(_first(prop.get("latitude"), address.get("latitude"))),
        "longitude": as_float(_first(prop.get("longitude"), address.get("longitude"))),
    }


def _json_ld_fields(ld):
    if not ld:
        return {}
    offers = ld.get("offers") if isinstance(ld.get("offers"), dict) else {}
    item = offers.get("itemOffered") if isinstance(offers.get("itemOffered"), dict) else {}
    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    geo = item.get("geo") if isinstance(item.get("geo"), dict) else {}
    floor = item.get("floorSize") if isinstance(item.get("floorSize"), dict) else {}
    return {
        "url": ld.get("url") if isinstance(ld.get("url"), str) else None,
        "street": address.get("streetAddress"),
        "city": address.get("addressLocality"),
        "state": address.get("addressRegion"),
        "zip": address.get("postalCode"),
        "latitude": as_float(geo.get("latitude")),
        "longitude": as_float(geo.get("longitude")),
        "price": as_int(offers.get("price")),
        "bedrooms": as_float(item.get("numberOfBedrooms")),
        "living_area": as_int(floor.get("value")),
        "property_type": normalize_property_type(item.get("@type")),
    }


# --- search page ------------------------------------------------------------

class SearchPage:
    """Parsed city search page: listing cards + next pagination URL."""

    __slots__ = ("listings", "next_url", "total_result_count")

    def __init__(self, listings=None, next_url=None, total_result_count=None):
        self.listings = listings or []
        self.next_url = next_url
        self.total_result_count = total_result_count


def parse_search_page(html):
    """Extract listResults + pagination.nextUrl from a search page.

    Raises ValueError when the page has no embedded search JSON at all (the
    caller decides whether that is a block page / soft failure).
    Verified by: test_parse_search_page_without_embedded_json_raises
    """
    data = extract_next_data(html)
    if not data:
        raise ValueError("no __NEXT_DATA__ embedded JSON on search page")
    page_props = (((data.get("props") or {}).get("pageProps")) or {})
    state = _as_dict(page_props.get("searchPageState"))
    if not state:
        raise ValueError("no searchPageState in embedded JSON")
    cat1 = _as_dict(state.get("cat1")) or {}
    results = _as_dict(cat1.get("searchResults")) or {}
    raw_list = results.get("listResults")
    listings = []
    if isinstance(raw_list, list):
        for item in raw_list:
            item = _as_dict(item)
            if isinstance(item, dict):
                listings.append(item)
    search_list = _as_dict(cat1.get("searchList")) or {}
    pagination = _as_dict(search_list.get("pagination")) or {}
    next_url = pagination.get("nextUrl")
    if next_url is not None and not isinstance(next_url, str):
        next_url = None
    total = as_int(search_list.get("totalResultCount"))
    return SearchPage(listings=listings, next_url=next_url, total_result_count=total)


# --- detail page ------------------------------------------------------------

def extract_detail_property(html):
    """The ``property`` object from a /homedetails/ page's gdpClientCache."""
    data = extract_next_data(html)
    if not data:
        return None
    page_props = (((data.get("props") or {}).get("pageProps")) or {})
    component = _as_dict(page_props.get("componentProps")) or {}
    cache = component.get("gdpClientCache")
    cache = _as_dict(cache)
    if not cache:
        return None
    # Prefer the priority-query entry that owns a "property" blob.
    # Verified by: NOTHING (gap — the fixture cache has no PriorityQuery key,
    # so the sort preference itself is untested; see REPO_MAP §10).
    ordered = sorted(cache.items(), key=lambda kv: ("PriorityQuery" not in kv[0], kv[0]))
    for _key, entry in ordered:
        entry = _as_dict(entry)
        if not entry:
            continue
        prop = _as_dict(entry.get("property"))
        if prop and prop.get("zpid") is not None:
            return prop
    return None
