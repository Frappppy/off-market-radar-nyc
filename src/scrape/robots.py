"""WHAT:      The robots compliance gate for stage 1 — ``is_allowed_url()``,
           ``DISALLOWED_PATH_PREFIXES`` and ``SEARCH_PATH_RE`` (plus the
           snapshot path the artifacts log references).
WHY:        This gate is a legal/compliance invariant (REPO_MAP I10): only
           robots-allowed zillow.com paths may ever be requested. It lives
           apart from tunables so a compliance review finds it in one file.
INPUTS:     A candidate URL string; the ``User-agent: *`` group of
            ``jobs/robots/zillow.com_robots.txt``.
OUTPUTS:    ``True`` (https, zillow host, no query/fragment, allowed path, not
            denied by the robots snapshot) or ``False``.
CALLERS:    ``src.scrape.http.ZillowClient.fetch`` (gate 1, every request),
            ``src.scrape.browser.BrowserSession.fetch`` (the same gate on the
            Playwright path — it used to rely on its callers only),
            ``src.scrape.run._fetch`` + ``._guard_redirect`` (redirect gate —
            deliberately a looser SUPERSET, see the comment on
            ``run.ScrapeRun._guard_redirect``), ``src.scrape.phases``,
            ``tests/test_scrape.py``.
TESTED BY:  ``tests/test_scrape.py::test_is_allowed_url``,
            ``tests/test_scrape.py::test_snapshot_denies_paths_the_shape_allows``,
            ``tests/test_scrape.py::test_snapshot_allows_the_shipped_url_shapes``,
            ``tests/test_scrape.py::test_snapshot_parse_survives_a_missing_file``.
"""

import re
from functools import lru_cache
from urllib.parse import urlparse

from .config import PROJECT_ROOT

ROBOTS_SNAPSHOT = PROJECT_ROOT / "jobs" / "robots" / "zillow.com_robots.txt"

#: Robots-disallowed path prefixes (I10). A hand-maintained floor, kept because
#  the redirect gate needs a superset test and because the snapshot may be
#  absent on a fresh clone. The authoritative deny list is the snapshot itself
#  (see ``snapshot_denies``). Verified by: test_is_allowed_url
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

# --- the robots snapshot, as the authority on what is denied ------------------

_RULE_RE = re.compile(r"^(Allow|Disallow)\s*:\s*(\S*)\s*$")
_UA_RE = re.compile(r"^User-agent\s*:\s*(\S+)\s*$")


def _rule_to_regex(pattern):
    """RFC 9309 path match: ``*`` is a wildcard, a trailing ``$`` anchors.

    An unanchored rule matches by PREFIX, so ``/m`` also denies ``/map`` — safe
    here because this layer only ever *denies*: the shape allowlist still
    decides what may be requested at all. An anchored rule must match to the
    end of the path, so ``/homes/for_sale/$`` denies exactly that page.
    """
    anchored = pattern.endswith("$")
    core = pattern[:-1] if anchored else pattern
    body = "".join(".*" if char == "*" else re.escape(char) for char in core)
    return re.compile(f"^{body}" + ("$" if anchored else ""))


@lru_cache(maxsize=4)
def _snapshot_rules(path=None):
    """``(specificity, verdict, regex)`` for the ``User-agent: *`` group.

    Empty tuple when the snapshot is unreadable: a missing evidence file must
    not widen access, and must not break the suite on a fresh clone either —
    callers then rely on ``DISALLOWED_PATH_PREFIXES`` alone.
    """
    target = str(path or ROBOTS_SNAPSHOT)
    try:
        with open(target, encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return ()
    rules, in_star, star_seen = [], False, False
    for line in lines:
        stripped = line.strip()
        ua = _UA_RE.match(stripped)
        if ua:
            if star_seen:
                break                       # the group after `*` is not ours
            in_star = ua.group(1) == "*"
            star_seen = star_seen or in_star
            continue
        if not in_star:
            continue
        rule = _RULE_RE.match(stripped)
        if rule and rule.group(2):
            pattern = rule.group(2)
            rules.append((len(pattern), rule.group(1), _rule_to_regex(pattern)))
    return tuple(rules)


def snapshot_denies(path, *, rules=None):
    """True when the snapshot's `*` group denies ``path``.

    Longest matching rule wins; ``Allow`` breaks a tie (RFC 9309 §2.2.1).
    """
    available = _snapshot_rules() if rules is None else rules
    best_length, best_verdict = -1, None
    for specificity, verdict, regex in available:
        if not regex.match(path):
            continue
        if specificity > best_length:
            best_length, best_verdict = specificity, verdict
        elif specificity == best_length and verdict == "Allow":
            best_verdict = "Allow"
    return best_verdict == "Disallow"


ZILLOW_HOSTS = ("www.zillow.com", "zillow.com")


def redirect_refusal(requested, final):
    """Why a redirect from ``requested`` to ``final`` is unacceptable, or None.

    Deliberately LOOSER than :func:`is_allowed_url` in one respect only — the
    host/prefix test carries no https/query/shape checks, because Zillow
    routinely redirects a plain search URL to the same URL *with* a query
    string, which the strict gate rejects by design
    (``docs/decisions.md`` §2). It is stricter in the other direction: the
    snapshot deny list applies to the redirect target too. Shared by both HTTP
    paths (``run.ScrapeRun._guard_redirect`` and
    ``browser.BrowserSession.fetch``), which previously each needed their own
    copy of this rule — and only one of them had it.
    Verified by: test_redirect_refusal
    """
    if not final or final.rstrip("/") == (requested or "").rstrip("/"):
        return None
    parts = urlparse(final)
    if (parts.hostname or "").lower() not in ZILLOW_HOSTS:
        return f"redirected off zillow.com to {final}"
    if parts.path.startswith(DISALLOWED_PATH_PREFIXES):
        return f"redirected to robots-disallowed path: {parts.path}"
    if snapshot_denies(parts.path):
        return f"redirected to a path the robots snapshot denies: {parts.path}"
    return None


def is_allowed_url(url):
    try:
        parts = urlparse(url)
    except Exception:
        return False
    if parts.scheme != "https":
        return False
    if (parts.hostname or "").lower() not in ZILLOW_HOSTS:
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
    if snapshot_denies(path):
        return False
    if path.startswith("/homedetails/"):
        return path.rstrip("/") != "/homedetails"
    return bool(SEARCH_PATH_RE.match(path))
