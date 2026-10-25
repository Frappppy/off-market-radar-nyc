"""WHAT:      The stage-1 HTTP client — ``ZillowClient`` (paced, single-flight,
            proxy + TLS-impersonated GETs), block detection
            (``looks_like_block``/``CaptchaBlocked``) and the 429/5xx/transport
            retry policy.
WHY:        Every network contact with Zillow funnels through this one class so
            the robots gate (gate 1, each request), the pacing floor and the
            CAPTCHA hard-stop (I11) cannot be sidestepped by any caller;
            retries live here so ``run``/``phases`` only ever see a final
            ``FetchResult``. Block detection is payload-aware and shares the
            one rule with the Playwright path (``parsing/payload.py``): a 403
            that still carries the embedded JSON is data, not a challenge,
            while any page carrying a PX marker aborts at every status.
INPUTS:     Proxy URL + pacing/timeout settings; URL strings; ``expect``
            (``"search"``/``"detail"``/``None``) for payload-aware detection.
OUTPUTS:    ``FetchResult`` dataclasses; raises ``CaptchaBlocked`` (never
            bypassed, I11) or ``RateLimited`` when the retry budget is spent. A
            soft 403 is recorded in ``FetchResult.audit`` and in the per-request
            audit list that lands in ``pages_fetched.json``.
CALLERS:    ``src.scrape.run.ScrapeRun`` (``_new_client``/``_fetch``);
            ``tests/test_scrape.py`` (``looks_like_block``).
TESTED BY:  ``tests/test_scrape.py::test_perimeterx_marker_is_detected``,
            ``tests/test_scrape.py::test_403_with_payload_is_not_a_block``,
            ``tests/test_scrape.py::test_403_challenge_page_is_still_a_block``,
            ``tests/test_scrape.py::test_403_with_no_payload_is_a_block``;
            the 429/5xx retry loops and pacing are untested (scrape
            enforcement-loop gap, REPO_MAP §10.4).
"""

import time
from dataclasses import dataclass, field
from typing import Optional

from curl_cffi import requests as cffi_requests

from ..common.timeutil import utc_now_iso
from .config import IMPERSONATE
from .parsing.payload import page_payload_kind
from .proxy import scrub_secrets
from .robots import is_allowed_url

# --- result type + block detection ------------------------------------------

PX_MARKERS = (
    "px-captcha",
    "access to this page has been denied",
    "press & hold to confirm",
)


class CaptchaBlocked(RuntimeError):
    def __init__(self, url, status):
        super().__init__(f"PerimeterX/CAPTCHA challenge (HTTP {status}) on {url}")
        self.url = url
        self.status = status


class RateLimited(RuntimeError):
    pass


@dataclass
class FetchResult:
    url: str
    status: int
    fetched_at: str
    text: str = ""
    final_url: str = ""
    error: Optional[str] = None
    retry_after: Optional[int] = None
    audit: dict = field(default_factory=dict)


def looks_like_block(status, text, expect=None):
    """Is this response a PerimeterX challenge we must stop on?

    A page carrying a PX marker is a block at *any* status — that is the hard
    stop (I11) and it is checked first, so nothing here makes the pipeline more
    permissive. What changed (2026-10-25) is the bare 403: Zillow answers some
    requests 403 *with the complete server-rendered payload* (verified
    2026-10-23 in ``jobs/harvest-probe/evidence/findings.md``, and the reason
    the harvest path detects by payload instead — see
    ``src/scrape/parsing/payload.py``). Treating every 403 as a challenge is
    what failed 7 of 10 scheduled runs on their very first request; a 403 whose
    payload parsed is a soft denial with usable data, and a 403 with neither
    marker nor payload still aborts.
    Verified by: test_perimeterx_marker_is_detected,
    test_403_with_payload_is_not_a_block, test_403_challenge_page_is_still_a_block,
    test_403_with_no_payload_is_a_block
    """
    head = (text or "")[:12000].lower()
    if any(marker in head for marker in PX_MARKERS):
        return True
    if status == 403:
        return page_payload_kind(text, expect=expect) is None
    return False


def _parse_retry_after(value):
    if not value:
        return None
    try:
        return int(str(value).strip())
    except ValueError:
        return None


# --- client -----------------------------------------------------------------


class ZillowClient:
    def __init__(self, proxy_url, min_delay=2.0, timeout=45.0):
        self._proxy_url = proxy_url
        self._min_delay = float(min_delay)
        self._timeout = float(timeout)
        self._last_start = 0.0
        self.audit = []
        # One persistent session per run: real browsers carry the cookies a
        # search page sets into subsequent /homedetails/ requests (why that
        # matters for PerimeterX here: docs/incidents/2026-10-15-px-cookie-chain.md).
        # This is ordinary browser behavior, never a challenge bypass - any
        # actual challenge still aborts the run below.
        self._session = cffi_requests.Session()

    def _pace(self):
        wait = self._min_delay - (time.monotonic() - self._last_start)
        if wait > 0:
            time.sleep(wait)

    def _get(self, url):
        self._pace()
        self._last_start = time.monotonic()
        fetched_at = utc_now_iso()
        try:
            response = self._session.get(
                url,
                impersonate=IMPERSONATE,
                proxies={"http": self._proxy_url, "https": self._proxy_url},
                timeout=self._timeout,
                allow_redirects=True,
            )
            result = FetchResult(
                url=url,
                status=int(response.status_code),
                fetched_at=fetched_at,
                text=response.text or "",
                final_url=str(response.url),
                retry_after=_parse_retry_after(response.headers.get("retry-after")),
            )
        except Exception as exc:
            result = FetchResult(
                url=url,
                status=-1,
                fetched_at=fetched_at,
                error=scrub_secrets(f"{type(exc).__name__}: {exc}"),
            )
        self.audit.append({"url": url, "status": result.status, "fetched_at": result.fetched_at})
        return result

    # --- gated fetching + retries --------------------------------------------

    def fetch(self, url, name=None, expect=None):
        if not is_allowed_url(url):
            raise ValueError(f"refusing URL outside robots-allowed Zillow paths: {url}")
        attempts_429 = 0
        attempts_5xx = 0
        attempts_transport = 0
        while True:
            result = self._get(url)
            if looks_like_block(result.status, result.text, expect=expect):
                raise CaptchaBlocked(url, result.status)
            if result.status == 403:
                # A 403 that still carried a parseable payload: usable, and
                # recorded as such so pages_fetched.json shows the distinction.
                kind = page_payload_kind(result.text, expect=expect)
                result.audit = {"soft_403": True, "payload": kind}
                if self.audit:
                    self.audit[-1]["soft_403"] = True
                    self.audit[-1]["payload"] = kind
            if result.status == 429:
                if attempts_429 >= 3:
                    raise RateLimited(f"HTTP 429 persisted after 3 backoffs on {url}")
                attempts_429 += 1
                wait = result.retry_after if result.retry_after and result.retry_after > 0 else min(30 * attempts_429, 120)
                if wait > 120:
                    raise RateLimited(f"HTTP 429 Retry-After={wait}s exceeds 120s budget on {url}")
                time.sleep(wait)
                continue
            if result.status >= 500 and attempts_5xx < 2:
                attempts_5xx += 1
                time.sleep(5)
                continue
            if result.status == -1 and attempts_transport < 1:
                attempts_transport += 1
                time.sleep(5)
                continue
            return result
