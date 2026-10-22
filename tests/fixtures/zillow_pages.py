"""Synthetic Zillow page fixtures shared by the scrape-stage tests.

WHAT:      Static JSON/HTML embeddings shaped like real Zillow search and detail
           pages, plus two builders that wrap them in the HTML a parser expects.
WHY:       The scrape tests must run fully offline -- no network, no proxy
           credentials, no recorded page dumps (the old `jobs/probe/*.html`
           scratch files were gitignored and no longer exist in the repo).
INPUTS:    The constants in this file only; nothing is read from disk or env.
OUTPUTS:   search_html()   -> str  a search page wrapping SEARCH_PAGE
           detail_html()   -> str  a detail page wrapping DETAIL_PROPERTY
           (both accept overrides so a test can mutate one field at a time).
CALLERS:   tests/test_scrape.py
TESTED BY: every test in tests/test_scrape.py that imports from this module.
"""

import json

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


def search_html(payload=None):
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


def detail_html(prop=None, price_cut_tag=False):
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
