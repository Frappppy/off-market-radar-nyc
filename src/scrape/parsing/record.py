"""WHAT: ``build_record()`` — merge search card + detail property + JSON-LD into one contract row. WHY: the precedence detail>search>JSON-LD must live in exactly one function; this body is a verbatim move from the pre-phase-2 ``src/scrape/parsers.py`` (line budget keeps it alone). INPUTS: ``entry`` (search card dict), ``prop`` (detail dict), ``detail_html``, ``json_ld``, ``scraped_at``. OUTPUTS: contract dict or ``None`` when no zpid/url can be established. CALLERS: ``src.scrape.run``/``.phases`` + ``tests/test_scrape.py`` (via ``parsing/__init__`` re-exports)."""
import re
from .coerce import _first, as_float, as_int, ms_to_date
from .derive import _detail_price_change, _search_home_info, _search_price_change, normalize_property_type, parse_price_history
from .extract import BASE_URL, _detail_address, _json_ld_fields
from .text import _site_cut_amount, parse_days_on_zillow_text, price_cut_flag_in_html

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
