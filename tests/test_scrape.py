"""Offline tests for stage 1 (scrape): parsers, robots gate, CLI contract.

No network: fixtures are synthetic embeddings shaped exactly like the real
Zillow pages recorded in ``jobs/probe/`` (see src/scrape/parsers.py docstring).
"""

import json

import pytest

from src.scrape import config, parsers
from src.scrape.cli import MIN_DELAY, build_parser
from src.scrape.http import looks_like_block
from src.scrape.pipeline import resolve_run_id

# --- fixtures ---------------------------------------------------------------

SEARCH_CARD = {
    "zpid": "123456",
    "detailUrl": "https://www.zillow.com/homedetails/1-Main-St-Brooklyn-NY-11201/123456_zpid/",
    "addressStreet": "1 Main St",
    "addressCity": "Brooklyn",
    "addressState": "NY",
    "addressZipcode": "11201",
    "address": "1 Main St, Brooklyn, NY 11201",
    "unformattedPrice": 500000,
    "price": "$500,000",
    "beds": 2,
    "baths": 1.0,
    "area": 1200,
    "latLong": {"latitude": 40.6941, "longitude": -73.9907},
    "statusText": "House for sale",
    "flexFieldText": "Price cut: $25,000 (9/1)",
    "hdpData": {
        "homeInfo": {
            "zpid": 123456,
            "homeType": "SINGLE_FAMILY",
            "daysOnZillow": 112,
            "priceChange": -25000,
            "price": 500000,
        }
    },
}

SEARCH_PAGE = {
    "props": {
        "pageProps": {
            "searchPageState": {
                "cat1": {
                    "searchResults": {"listResults": [SEARCH_CARD]},
                    "searchList": {
                        "pagination": {"nextUrl": "/new-york-ny/2_p/"},
                        "totalResultCount": 22756,
                    },
                }
            }
        }
    }
}


def _search_html(payload=None):
    body = json.dumps(payload or SEARCH_PAGE)
    return f'<html><script id="__NEXT_DATA__" type="application/json">{body}</script></html>'


DETAIL_PROPERTY = {
    "zpid": 123456,
    "streetAddress": "1 Main St",
    "hdpUrl": "/homedetails/1-Main-St-Brooklyn-NY-11201/123456_zpid/",
    "city": "Brooklyn",
    "state": "NY",
    "zipcode": "11201",
    "latitude": 40.6941,
    "longitude": -73.9907,
    "price": 475000,
    "priceChange": -25000,
    "priceChangeDateString": "2026-09-01",
    "bedrooms": 2,
    "bathrooms": 1.0,
    "livingArea": 1200,
    "daysOnZillow": 112,
    "datePosted": 1781308800000,  # 2026-06-13T00:00:00Z
    "homeType": "CONDO",
    "resoFacts": {"homeType": "Cooperative", "propertySubType": ["Coop"]},
    "priceHistory": [
        {"date": "2026-09-01", "price": 475000},
        {"date": "2026-06-12", "price": 500000},
        {"date": "2011-05-01", "price": 300000, "event": "Sold"},
    ],
}


def _detail_html(prop=None, price_cut_tag=False):
    cache = {"Query{\"zpid\":123456}": {"property": prop or DETAIL_PROPERTY}}
    next_data = {
        "props": {
            "pageProps": {
                "componentProps": {
                    # real pages ship gdpClientCache as a JSON *string*
                    "gdpClientCache": json.dumps(cache)
                }
            }
        }
    }
    tag = '<span class="price-change-tag"><span>Price cut: $25K (9/1)</span></span>' if price_cut_tag else ""
    ld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": ["RealEstateListing", "Product"],
            "url": "https://www.zillow.com/homedetails/1-Main-St-Brooklyn-NY-11201/123456_zpid/",
            "offers": {"price": 475000, "itemOffered": {"@type": "House"}},
        }
    )
    return (
        "<html>"
        + tag
        + f'<script type="application/ld+json">{ld}</script>'
        + f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(next_data)}</script>'
        + "</html>"
    )


PX_PAGE = (
    '<html lang="en"><head><meta charset="utf-8">'
    '<meta name="description" content="px-captcha">'
    "<title>Access to this page has been denied</title></head>"
    "<body><script>window._pxAppId = 'PXHYx10rg3';</script></body></html>"
)

# --- search parsing ---------------------------------------------------------


def test_parse_search_page_extracts_cards_and_next_url():
    page = parsers.parse_search_page(_search_html())
    assert len(page.listings) == 1
    assert page.next_url == "/new-york-ny/2_p/"
    assert page.total_result_count == 22756


def test_parse_search_page_without_embedded_json_raises():
    with pytest.raises(ValueError, match="no __NEXT_DATA__"):
        parsers.parse_search_page("<html><body>shell</body></html>")


def test_search_only_record_obeys_contract_shape():
    record = parsers.build_record(
        SEARCH_CARD, None, None, None, scraped_at="2026-10-15T00:00:00Z"
    )
    assert record["source"] == "zillow"
    assert record["listing_id"] == "123456"
    assert record["price_current"] == 500000
    assert record["price_previous"] == 525000          # cut delta from search card
    assert record["price_reduced"] is True             # site flag + derived
    assert record["days_on_market"] == 112
    assert record["latitude"] == 40.6941
    assert record["zip"] == "11201"
    assert record["state"] == "NY"
    assert record["property_type"] == "house"          # statusText "House for sale"
    assert record["scraped_at"] == "2026-10-15T00:00:00Z"
    assert set(record) == {
        "source", "listing_id", "url", "address_raw", "city", "state", "zip",
        "latitude", "longitude", "price_current", "price_previous",
        "price_reduced", "property_type", "bedrooms", "bathrooms",
        "living_area_sqft", "days_on_market", "listed_date", "price_history",
        "scraped_at",
    }


# --- detail parsing ---------------------------------------------------------

def test_extract_detail_property_unwraps_stringified_cache():
    prop = parsers.extract_detail_property(_detail_html())
    assert prop["zpid"] == 123456


def test_detail_overrides_search_and_derives_price_fields():
    record = parsers.build_record(
        SEARCH_CARD,
        DETAIL_PROPERTY,
        _detail_html(price_cut_tag=True),
        None,
        scraped_at="2026-10-15T00:00:00Z",
    )
    assert record["price_current"] == 475000
    assert record["price_previous"] == 500000          # 475000 - (-25000)
    assert record["price_reduced"] is True             # site priceChange + HTML tag
    assert record["listed_date"] == "2026-06-13"       # from datePosted (UTC)
    assert record["days_on_market"] == 112
    assert record["property_type"] == "co-op"          # resoFacts beats homeType CONDO
    history = record["price_history"]
    assert [row["event"] for row in history] == ["Price change", None, "Sold"]
    assert history[0]["price"] == 475000


def test_price_history_none_when_absent():
    prop = dict(DETAIL_PROPERTY, priceHistory=None)
    record = parsers.build_record(None, prop, None, None, scraped_at="x")
    assert record["price_history"] is None


def test_json_ld_only_detail_still_builds():
    ld = {
        "@type": ["RealEstateListing"],
        "url": "https://www.zillow.com/homedetails/x/9_zpid/",
        "offers": {
            "price": 300000,
            "itemOffered": {
                "@type": "Cooperative",
                "address": {
                    "streetAddress": "9 Pine St",
                    "addressLocality": "New York",
                    "addressRegion": "NY",
                    "postalCode": "10001",
                },
                "geo": {"latitude": 40.75, "longitude": -73.99},
            },
        },
    }
    record = parsers.build_record(
        None, None, None, ld, scraped_at="2026-10-15T00:00:00Z"
    )
    assert record["listing_id"] == "9"
    assert record["price_current"] == 300000
    assert record["property_type"] == "co-op"
    assert record["zip"] == "10001"


def test_unusable_card_returns_none():
    assert parsers.build_record(None, None, None, None, scraped_at="x") is None


# --- property type + helpers ------------------------------------------------

@pytest.mark.parametrize(
    "candidates,expected",
    [
        (("Cooperative",), "co-op"),
        ((["Coop"],), "co-op"),
        (("SINGLE_FAMILY",), "house"),
        (("Condominium",), "condo"),
        (("Multi-family home for sale",), "multi-family"),
        (("TOWNHOUSE",), "townhouse"),
        (("Vacant Land",), "land"),
        (("Mobile Home",), "other"),
        ((None, None), "other"),
        (("Cooperative", "CONDO"), "co-op"),  # detail resoFacts comes before homeType
        (("CONDO", "Cooperative"), "condo"),  # candidate order is authoritative
    ],
)
def test_normalize_property_type(candidates, expected):
    assert parsers.normalize_property_type(*candidates) == expected


def test_contract_enum_exhaustive():
    assert parsers.PROPERTY_TYPES == (
        "house", "condo", "co-op", "townhouse", "multi-family", "land", "other",
    )


def test_price_cut_and_days_text_parsers():
    assert parsers.parse_price_cut_text("Price cut: $15,000 (10/6)") == 15000
    assert parsers.parse_price_cut_text("Showcase") is None
    assert parsers.parse_days_on_zillow_text("321 days on Zillow") == 321
    assert parsers.parse_dollar_amount("$51,000 (Sep 30)") == 51000


def test_ms_to_date_utc():
    assert parsers.ms_to_date(1791244800000) == "2026-10-06"
    assert parsers.ms_to_date(None) is None


# --- robots gate (config) ---------------------------------------------------

@pytest.mark.parametrize(
    "url,allowed",
    [
        ("https://www.zillow.com/new-york-ny/", True),
        ("https://www.zillow.com/new-york-ny/2_p/", True),
        ("https://www.zillow.com/new-york-ny/_p/2/", True),
        ("https://www.zillow.com/brooklyn-new-york-ny/3_p/", True),
        ("https://www.zillow.com/homedetails/1-Main-St-Brooklyn-NY-11201/1_zpid/", True),
        ("https://www.zillow.com/robots.txt", True),
        ("https://www.zillow.com/api/gis?foo", False),
        ("https://www.zillow.com/graphql/", False),
        ("https://www.zillow.com/search/HDPMapResults.htm", False),
        ("https://www.zillow.com/homes/for_sale/", False),
        ("https://www.zillow.com/new-york-ny/?sort=pricea", False),
        ("http://www.zillow.com/new-york-ny/", False),          # https only
        ("https://evil.example/new-york-ny/", False),           # host only
        ("https://www.zillow.com/homedetails/x/1_zpid/?altId=2", False),
    ],
)
def test_is_allowed_url(url, allowed):
    assert config.is_allowed_url(url) is allowed


def test_proxy_url_uses_mandatory_geo_and_never_leaks_in_display():
    url = config.build_proxy_url(sessid="project1")
    creds = config.load_dataimpulse_credentials()
    if not creds.get("DATAIMPULSE_LOGIN"):  # no credentials in this environment
        pytest.skip("no DataImpulse credentials on this machine")
    assert "__cr.us" in url and ";sessid.project1:" in url
    display = config.proxy_display("project1")
    assert creds["DATAIMPULSE_PASSWORD"] not in display
    assert creds["DATAIMPULSE_LOGIN"] not in display


def test_scrub_secrets_masks_credentials():
    creds = config.load_dataimpulse_credentials()
    if not creds.get("DATAIMPULSE_PASSWORD"):
        pytest.skip("no DataImpulse credentials on this machine")
    text = f"boom {creds['DATAIMPULSE_PASSWORD']} end"
    assert creds["DATAIMPULSE_PASSWORD"] not in config.scrub_secrets(text)


# --- CAPTCHA detection (http) ----------------------------------------------

def test_perimeterx_marker_is_detected():
    assert looks_like_block(200, PX_PAGE) is True
    assert looks_like_block(403, "<html></html>") is True
    assert looks_like_block(200, "<html>" + "x" * 50000 + "</html>") is False


# --- CLI contract -----------------------------------------------------------

def test_cli_defaults_match_contract():
    args = build_parser().parse_args(["--out", "jobs/x/raw"])
    assert args.pages == 5
    assert args.max_details == 150
    assert args.out_path == "jobs/x/raw"
    assert MIN_DELAY == 2.0  # hard pacing floor


def test_resolve_run_id_prefers_parent_dir():
    from pathlib import Path

    assert resolve_run_id(Path("jobs/20261014-143000/raw")) == "20261014-143000"
    stamp = resolve_run_id(Path("jobs/smoke-scrape-x/raw"))
    import re

    assert re.fullmatch(r"\d{8}-\d{6}", stamp)
