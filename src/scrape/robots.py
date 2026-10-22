"""WHAT:      The robots compliance gate for stage 1 — ``is_allowed_url()``,
           ``DISALLOWED_PATH_PREFIXES`` and ``SEARCH_PATH_RE`` (plus the
           snapshot path the artifacts log references).
WHY:        This gate is a legal/compliance invariant (REPO_MAP I10): only
           robots-allowed zillow.com paths may ever be requested. It lives
           apart from tunables so a compliance review finds it in one file.
INPUTS:     A candidate URL string.
OUTPUTS:    ``True`` (https, zillow host, no query/fragment, allowed path) or
            ``False``.
CALLERS:    ``src.scrape.http.ZillowClient.fetch`` (gate 1, every request),
            ``src.scrape.run._fetch`` + ``._guard_redirect`` (redirect gate —
            deliberately a looser SUPERSET, see the comment on
            ``run.ScrapeRun._guard_redirect``), ``src.scrape.phases``,
            ``tests/test_scrape.py`` (14 parametrised cases).
TESTED BY:  ``tests/test_scrape.py::test_is_allowed_url``.
"""

import re
from urllib.parse import urlparse

from .config import PROJECT_ROOT

ROBOTS_SNAPSHOT = PROJECT_ROOT / "jobs" / "robots" / "zillow.com_robots.txt"

#: Robots-disallowed path prefixes (I10). Verified by: test_is_allowed_url
DISALLOWED_PATH_PREFIXES = (
    "/api/",
    "/graphql/",
    "/search/",
    "/ajax/",
    "/b/",
    "/homes/",
    "/homedetail/",
    "/imf-fetch-message/",
    "/mobile/",
    "/mortgage/",
    "/ofr/api/",
    "/rentals/",
    "/rental-manager/",
    "/s/",
    "/savedhomes/",
    "/user/",
    "/captcha/",
    "/view-imx/",
    "/view-3d-home",
    "/deferred",
    "/async-create-search-page-state",
    "/shopper-platform/",
    "/zg-graph/",
)

#: Robots-allowed city search pages: `/<slug>/`, `/<slug>/2_p/` (Zillow's
#  real page-2+ format, taken from the page's own `pagination.nextUrl`),
#  plus the legacy `/<slug>/_p/` and `/<slug>/_p/2/` variants.
#  Verified by: test_is_allowed_url
SEARCH_PATH_RE = re.compile(
    r"^/[A-Za-z0-9][A-Za-z0-9_\-]*/(?:\d+_p/|_p/(?:\d+/)?)?$"
)


def is_allowed_url(url):
    try:
        parts = urlparse(url)
    except Exception:
        return False
    if parts.scheme != "https":
        return False
    if (parts.hostname or "").lower() not in ("www.zillow.com", "zillow.com"):
        return False
    if parts.query or parts.fragment:
        return False
    path = parts.path
    if not path or "%" in path or ".." in path:
        return False
    if path == "/robots.txt":
        return True
    if path.startswith(DISALLOWED_PATH_PREFIXES):
        return False
    if "/rental-manager/" in path or "view=owner" in path:
        return False
    if path.startswith("/homedetails/"):
        return path.rstrip("/") != "/homedetails"
    return bool(SEARCH_PATH_RE.match(path))
