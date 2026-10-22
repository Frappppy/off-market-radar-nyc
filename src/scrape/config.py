"""WHAT:      Stage-1 constants only — run caps, session default, start URL and
           seed pages. Behaviour (robots gate, proxy credentials) lives in the
           sibling ``robots`` / ``proxy`` modules.
WHY:        Split (phase 2) so compliance rules (``robots.py``) and secret
           handling (``proxy.py``) are reviewable apart from tunables.
INPUTS:     None (constants; paths derived from the repo root).
OUTPUTS:    ``PROJECT_ROOT``, ``IMPERSONATE``, ``DEFAULT_PAGES``,
            ``DEFAULT_MAX_DETAILS``, ``DEFAULT_DELAY``, ``DEFAULT_TIMEOUT``,
            ``DEFAULT_SESSION``, ``START_URL``, ``DEFAULT_PAGE_URLS``.
CALLERS:    ``src.scrape.{http,run,phases,artifacts,robots,proxy,cli}``,
            ``tests/test_scrape.py``.
TESTED BY:  ``tests/test_scrape.py::test_cli_defaults_match_contract``
            (DEFAULT_PAGES/DEFAULT_MAX_DETAILS/MIN_DELAY-derived floor);
            ``DEFAULT_SESSION``/``START_URL``/``DEFAULT_PAGE_URLS`` only via
            the phase-1 golden dump — see per-constant notes below.
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

IMPERSONATE = "chrome124"
DEFAULT_PAGES = 5
DEFAULT_MAX_DETAILS = 150
DEFAULT_DELAY = 2.0
DEFAULT_TIMEOUT = 45.0

#: Sticky DataImpulse session name for a run (URL: {login}__cr.us;sessid.<name>:...).
#: ``None`` = plain rotating exit (every request gets a fresh NY residential IP).
#: Why the default is rotating (sticky ``project1`` 403): see
#: docs/incidents/2026-10-15-proxy-sticky-403.md. Sticky sessions stay supported
#: (constructor arg, used for 429 rotation and explicit runs).
DEFAULT_SESSION = None

START_URL = "https://www.zillow.com/new-york-ny/"

#: last-resort seeds, used only if the pagination chain stops early.
#: Verified by: NOTHING (gap — the pagination-exhaustion path in
#: ``phases._search_phase`` is untested; see REPO_MAP §10).
DEFAULT_PAGE_URLS = [
    START_URL,
    "https://www.zillow.com/new-york-ny/_p/",
    "https://www.zillow.com/brooklyn-ny/",
    "https://www.zillow.com/queens-ny/",
    "https://www.zillow.com/manhattan-ny/",
]
