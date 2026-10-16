import os
import re
from pathlib import Path
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOCAL_ENV = PROJECT_ROOT / "config" / "dataimpulse.local.env"
ROBOTS_SNAPSHOT = PROJECT_ROOT / "jobs" / "robots" / "zillow.com_robots.txt"

IMPERSONATE = "chrome124"
DEFAULT_PAGES = 5
DEFAULT_MAX_DETAILS = 150
DEFAULT_DELAY = 2.0
DEFAULT_TIMEOUT = 45.0

#: Sticky DataImpulse session name for a run (URL: {login}__cr.us;sessid.<name>:...).
#: ``None`` = plain rotating exit (every request gets a fresh NY residential IP).
#: 2026-10-15: the default run uses plain rotating - the sticky ``project1``
#: exit answered the very first Zillow request with a PerimeterX 403, while
#: the pre-check probe succeeded through a rotating exit (jobs/probe/
#: nyc_search_rotating.html). Sticky sessions stay supported (constructor arg,
#: used for 429 rotation and explicit runs).
DEFAULT_SESSION = None

START_URL = "https://www.zillow.com/new-york-ny/"

#: last-resort seeds, used only if the pagination chain stops early.
#: Verified by the pre-check probe (jobs/probe/search_*.html).
DEFAULT_PAGE_URLS = [
    START_URL,
    "https://www.zillow.com/new-york-ny/_p/",
    "https://www.zillow.com/brooklyn-ny/",
    "https://www.zillow.com/queens-ny/",
    "https://www.zillow.com/manhattan-ny/",
]

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
SEARCH_PATH_RE = re.compile(
    r"^/[A-Za-z0-9][A-Za-z0-9_\-]*/(?:\d+_p/|_p/(?:\d+/)?)?$"
)

_credentials_cache = None


def load_dataimpulse_credentials():
    """Credentials for the DataImpulse proxy.

    The gitignored project file (``config/dataimpulse.local.env``) is
    **authoritative when present**; OS environment variables fill only the
    keys the file does not provide. Precedence matters: on 2026-10-15 stale
    machine-level ``DATAIMPULSE_LOGIN``/``DATAIMPULSE_PASSWORD`` env vars
    shadowed the file and every proxy CONNECT failed with ``407 NO_USER``,
    while the file's credentials authenticated fine (``200 OK``).
    """
    global _credentials_cache
    if _credentials_cache is not None:
        return dict(_credentials_cache)
    creds = {}
    if LOCAL_ENV.exists():
        for line in LOCAL_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key.startswith("DATAIMPULSE_") and value.strip():
                creds[key] = value.strip()
    for key in ("DATAIMPULSE_LOGIN", "DATAIMPULSE_PASSWORD", "DATAIMPULSE_HOST", "DATAIMPULSE_PORT"):
        value = os.environ.get(key)
        if value and value.strip() and key not in creds:
            creds[key] = value.strip()
    _credentials_cache = dict(creds)
    return dict(creds)


def build_proxy_url(sessid=None):
    creds = load_dataimpulse_credentials()
    login = creds.get("DATAIMPULSE_LOGIN")
    password = creds.get("DATAIMPULSE_PASSWORD")
    if not login or not password:
        return None
    host = creds.get("DATAIMPULSE_HOST") or "gw.dataimpulse.com"
    port = creds.get("DATAIMPULSE_PORT") or "823"
    user = f"{login}__cr.us"
    if sessid:
        user = f"{user};sessid.{sessid}"
    return f"http://{user}:{password}@{host}:{port}"


def proxy_display(sessid=None):
    creds = load_dataimpulse_credentials()
    host = creds.get("DATAIMPULSE_HOST") or "gw.dataimpulse.com"
    port = creds.get("DATAIMPULSE_PORT") or "823"
    mode = f"sessid={sessid}" if sessid else "rotating"
    return f"{host}:{port} (cr.us, {mode})"


def scrub_secrets(text):
    if not text:
        return text
    creds = load_dataimpulse_credentials()
    for key in ("DATAIMPULSE_PASSWORD", "DATAIMPULSE_LOGIN"):
        value = creds.get(key)
        if value:
            text = text.replace(value, "***")
    return text


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


def url_slug(url):
    parts = urlparse(url)
    return parts.path.strip("/").replace("/", "_") or "root"
