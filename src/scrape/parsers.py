"""Zillow page parsing for stage 1 (scrape).

The pre-check probe (``jobs/probe/*.html``) proved every target page ships its
data as **server-rendered embedded JSON**, so the rule here is
"embedded JSON -> parse it, always":

* search pages -> ``<script id="__NEXT_DATA__">`` -> ``pageProps.searchPageState.cat1``
  (``searchResults.listResults`` + ``searchList.pagination.nextUrl``)
* detail pages -> ``<script id="__NEXT_DATA__">`` -> ``componentProps.gdpClientCache``
  -> ``property`` (price, priceHistory, resoFacts, daysOnZillow, ...)
* fallback     -> ``<script type="application/ld+json">`` RealEstateListing

HTML/CSS scraping is limited to the site's own "Price cut" flag text.  Every
function here is pure (no I/O) so it stays unit-testable.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

BASE_URL = "https://www.zillow.com"

#: docs/data_contract.md — property_type enum (co-op matters in NYC)
PROPERTY_TYPES = (
    "house",
    "condo",
    "co-op",
    "townhouse",
    "multi-family",
    "land",
    "other",
)

_NEXT_DATA_RE = re.compile(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*>(?P<json>.*?)</script>', re.DOTALL
)
_JSON_LD_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>(?P<json>.*?)</script>', re.DOTALL
)
_PRICE_CUT_TEXT_RE = re.compile(r"Price cut\s*:", re.IGNORECASE)
_FLEX_PRICE_CUT_RE = re.compile(r"Price cut:\s*\$\s*([\d,]+)")
_DOLLAR_AMOUNT_RE = re.compile(r"\$\s*([\d,]+)")
_DAYS_TEXT_RE = re.compile(r"(\d+)\s+days?\s+on\s+Zillow", re.IGNORECASE)


# --- tiny null-safe coercions ----------------------------------------------

def _first(*values):
    """First value that is present (None/missing only — 0 and False count)."""
    for value in values:
        if value is None:
            continue
        if isinstance(value, float) and value != value:  # NaN
            continue
        return value
    return None


def as_int(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return int(round(number))


def as_float(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if number != number else number


def ms_to_date(value):
    """Epoch milliseconds -> ``YYYY-MM-DD`` (UTC)."""
    number = as_float(value)
    if number is None:
        return None
    try:
        return datetime.fromtimestamp(number / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d")
    except (OverflowError, OSError, ValueError):
        return None


# --- embedded-JSON extraction ----------------------------------------------

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


def _as_dict(value):
    """Nested blobs are sometimes JSON strings; unwrap once."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None


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
    ordered = sorted(cache.items(), key=lambda kv: ("PriorityQuery" not in kv[0], kv[0]))
    for _key, entry in ordered:
        entry = _as_dict(entry)
        if not entry:
            continue
        prop = _as_dict(entry.get("property"))
        if prop and prop.get("zpid") is not None:
            return prop
    return None


def price_cut_flag_in_html(html):
    """True when the server-rendered page shows Zillow's own "Price cut" tag."""
    if not html:
        return False
    head = html[: len(html)]  # full page: flag lives in the listing header block
    return bool(_PRICE_CUT_TEXT_RE.search(head)) or "price-change-tag" in head


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


# --- property_type normalization -------------------------------------------

def _norm_token(value):
    return re.sub(r"[\s_\-]+", "", str(value)).lower()


#: ordered (needle, contract-enum) rules — evaluated on a whitespace-stripped
#: lowercase token, so "Multi-family home for sale" and "MULTI_FAMILY" both hit.
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
    """Label one price-history row.

    The embedded ``priceHistory`` usually carries only ``{date, price}``; the
    label is derived strictly from verifiable anchors on the same record
    (most recent price cut, last sale, current list price) and stays ``null``
    when no anchor matches — never invented.
    """
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


# --- record assembly --------------------------------------------------------

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


def build_record(entry, prop, detail_html, json_ld, scraped_at):
    """Merge search card + detail property + JSON-LD into one contract row.

    Precedence: detail embedded JSON > search embedded JSON > JSON-LD.
    Returns None when no zpid/url can be established (unusable row).
    """
    info = _search_home_info(entry)
    detail_addr = _detail_address(prop)
    ld = _json_ld_fields(json_ld)

    zpid = _first(
        (prop or {}).get("zpid") if prop else None,
        (entry or {}).get("zpid") if entry else None,
    )
    zpid = str(zpid) if zpid is not None else None

    url = _first(
        (entry or {}).get("detailUrl") if entry else None,
        (prop or {}).get("hdpUrl") if prop else None,
        ld.get("url"),
    )
    if isinstance(url, str) and url.startswith("/"):
        url = BASE_URL + url
    if not isinstance(url, str) or not url:
        url = None
    if zpid is None and url:
        zpid_match = re.search(r"/(\d+)_zpid/", url)  # JSON-LD-only fallback
        if zpid_match:
            zpid = zpid_match.group(1)

    address_raw = _first(
        detail_addr.get("street"),
        (entry or {}).get("addressStreet") if entry else None,
        ld.get("street"),
    )
    if address_raw is not None:
        address_raw = str(address_raw)
    if zpid is None or url is None or address_raw is None:
        return None

    city = _first(
        detail_addr.get("city"),
        (entry or {}).get("addressCity") if entry else None,
        ld.get("city"),
        info.get("city"),
    )
    state = _first(
        detail_addr.get("state"),
        (entry or {}).get("addressState") if entry else None,
        ld.get("state"),
        info.get("state"),
    )
    if isinstance(state, str):
        state = state.strip().upper() or None
    zip_code = _first(
        detail_addr.get("zip"),
        (entry or {}).get("addressZipcode") if entry else None,
        ld.get("zip"),
        info.get("zipcode"),
    )
    zip_code = str(zip_code) if zip_code not in (None, "") else None

    latitude = _first(
        detail_addr.get("latitude"),
        ((entry or {}).get("latLong") or {}).get("latitude")
        if isinstance((entry or {}).get("latLong"), dict)
        else None,
        as_float(info.get("latitude")),
        ld.get("latitude"),
    )
    longitude = _first(
        detail_addr.get("longitude"),
        ((entry or {}).get("latLong") or {}).get("longitude")
        if isinstance((entry or {}).get("latLong"), dict)
        else None,
        as_float(info.get("longitude")),
        ld.get("longitude"),
    )

    price_current = as_int(
        _first(
            (prop or {}).get("price") if prop else None,
            (entry or {}).get("unformattedPrice") if entry else None,
            info.get("price"),
            info.get("priceForHDP"),
            ld.get("price"),
        )
    )

    # --- price cut: site flag first, then stated cut amount, then delta -----
    detail_cut = _detail_price_change(prop) if prop else None
    search_cut = _search_price_change(entry) if entry else None
    cut_amount = _site_cut_amount(entry, prop)
    html_cut = price_cut_flag_in_html(detail_html)

    price_previous = None
    if price_current is not None:
        if detail_cut is not None:
            price_previous = price_current - detail_cut
        elif search_cut is not None:
            price_previous = price_current - search_cut
        elif cut_amount:
            price_previous = price_current + cut_amount

    site_flag = bool(html_cut or detail_cut is not None or search_cut is not None or cut_amount)
    derived = bool(
        price_previous is not None
        and price_current is not None
        and price_previous > price_current
    )
    price_reduced = site_flag or derived

    # --- property type: detail resoFacts is the co-op authority -------------
    reso = (prop or {}).get("resoFacts") if prop else None
    reso = reso if isinstance(reso, dict) else {}
    property_type = normalize_property_type(
        reso.get("homeType"),
        reso.get("propertySubType"),
        (prop or {}).get("propertyTypeDimension") if prop else None,
        (prop or {}).get("homeType") if prop else None,
        (entry or {}).get("statusText") if entry else None,
        info.get("homeType"),
        ld.get("property_type"),
    )

    bedrooms = as_float(
        _first(
            (prop or {}).get("bedrooms") if prop else None,
            (entry or {}).get("beds") if entry else None,
            info.get("bedrooms"),
            ld.get("bedrooms"),
        )
    )
    bathrooms = as_float(
        _first(
            (prop or {}).get("bathrooms") if prop else None,
            (entry or {}).get("baths") if entry else None,
            info.get("bathrooms"),
        )
    )
    living_area = as_int(
        _first(
            (prop or {}).get("livingArea") if prop else None,
            (prop or {}).get("livingAreaValue") if prop else None,
            (entry or {}).get("area") if entry else None,
            info.get("livingArea"),
            ld.get("living_area"),
        )
    )

    # --- days on market ------------------------------------------------------
    seconds = as_float((prop or {}).get("secondsOnZillow")) if prop else None
    days_on_market = as_int(
        _first(
            (prop or {}).get("daysOnZillow") if prop else None,
            int(seconds // 86400) if seconds else None,
            info.get("daysOnZillow"),
            parse_days_on_zillow_text(
                (entry or {}).get("flexFieldText") if entry else None
            ),
        )
    )

    listed_date = None
    if prop:
        listed_date = ms_to_date(
            _first(prop.get("comingSoonOnMarketDate"), prop.get("datePosted"))
        )

    price_history = parse_price_history(prop) if prop else None

    return {
        "source": "zillow",
        "listing_id": zpid,
        "url": url,
        "address_raw": address_raw,
        "city": str(city) if city is not None else None,
        "state": state,
        "zip": zip_code,
        "latitude": as_float(latitude),
        "longitude": as_float(longitude),
        "price_current": price_current,
        "price_previous": price_previous,
        "price_reduced": bool(price_reduced),
        "property_type": property_type,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "living_area_sqft": living_area,
        "days_on_market": days_on_market,
        "listed_date": listed_date,
        "price_history": price_history,
        "scraped_at": scraped_at,
    }
