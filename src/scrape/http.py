import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests

from .config import IMPERSONATE, is_allowed_url, scrub_secrets, url_slug

PX_MARKERS = (
    "px-captcha",
    "access to this page has been denied",
    "press & hold to confirm",
)


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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
    error: str = None
    retry_after: int = None
    audit: dict = field(default_factory=dict)


def looks_like_block(status, text):
    if status == 403:
        return True
    if not text:
        return False
    head = text[:12000].lower()
    return any(marker in head for marker in PX_MARKERS)


def _parse_retry_after(value):
    if not value:
        return None
    try:
        return int(str(value).strip())
    except ValueError:
        return None


class ZillowClient:
    def __init__(self, proxy_url, min_delay=2.0, timeout=45.0, html_dir=None):
        self._proxy_url = proxy_url
        self._min_delay = float(min_delay)
        self._timeout = float(timeout)
        self._html_dir = Path(html_dir) if html_dir else None
        self._last_start = 0.0
        self.audit = []
        # One persistent session per run: real browsers carry the cookies a
        # search page sets into subsequent /homedetails/ requests. Without
        # them PerimeterX challenged detail pages that pass when the cookie
        # chain is intact (verified 2026-10-15: the same detail URL answered
        # 403 twice from cookie-less clients and 200 from this session).
        # This is ordinary browser behavior, never a challenge bypass - any
        # actual challenge still aborts the run below.
        self._session = cffi_requests.Session()

    def _pace(self):
        wait = self._min_delay - (time.monotonic() - self._last_start)
        if wait > 0:
            time.sleep(wait)

    def _save_html(self, name, result):
        if self._html_dir is None or not result.text:
            return
        target = name or url_slug(result.url)
        try:
            (self._html_dir / f"{target}.html").write_text(result.text, encoding="utf-8")
        except OSError:
            pass

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

    def fetch(self, url, name=None):
        if not is_allowed_url(url):
            raise ValueError(f"refusing URL outside robots-allowed Zillow paths: {url}")
        attempts_429 = 0
        attempts_5xx = 0
        attempts_transport = 0
        while True:
            result = self._get(url)
            self._save_html(name, result)
            if looks_like_block(result.status, result.text):
                raise CaptchaBlocked(url, result.status)
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
