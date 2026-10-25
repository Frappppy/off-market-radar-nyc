"""WHAT:      Playwright browser session for full-corpus harvesting — persistent
           profile (cookies survive restarts), residential proxy wiring, asset
           blocking, and the manual-CAPTCHA pause.
WHY:        Zillow now answers with HTTP 403 *and* a fully server-rendered page:
           the payload is present even when the status says "denied" (verified
           2026-10-23, `jobs/harvest-probe/`). So the only trustworthy block
           signal is "is the expected JSON payload in the DOM", not the status
           code. When the payload is genuinely missing and a PerimeterX
           challenge is on screen, a human solves it in the visible window —
           this module never attempts to defeat it.
INPUTS:     Profile dir, proxy dict (from ``proxy.build_browser_proxy``),
           pacing/timeout knobs.
OUTPUTS:    ``FetchPage`` per navigation; ``challenged``/``waited_s`` tell the
           caller a human interaction happened.
CALLERS:    ``src.scrape.harvest``.
TESTED BY:  ``tests/test_harvest.py::test_payload_detection_*`` (parser-level;
           live browser paths are smoke-tested, not unit-tested).
"""

from __future__ import annotations

import random
import subprocess
import time
from dataclasses import dataclass, field

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

from ..common.timeutil import utc_now_iso
from .parsing import extract_detail_property, parse_search_page
from .proxy import scrub_secrets

BLOCKED_RESOURCE_TYPES = {"image", "media", "font"}
BLOCKED_HOST_PARTS = (
    "google-analytics", "googletagmanager", "doubleclick", "facebook.net",
    "hotjar", "segment.io", "scorecardresearch", "adsrvr", "criteo",
)

CHALLENGE_TITLE = ("access to this page has been denied", "just a moment")
CHALLENGE_TEXT = ("press & hold", "verify you are human", "px-captcha")


def _dismiss_notice(page):
    """Best-effort close of the cookie/consent banner (it overlaps nothing
    the parser needs, but a click keeps the human-solve screen usable)."""
    for label in ("Accept", "Accept All", "I agree"):
        try:
            button = page.get_by_role("button", name=label, exact=False)
            if button.count():
                button.first.click(timeout=1500)
                return
        except (PlaywrightError, PlaywrightTimeout):
            continue


def page_payload_kind(html, expect=None):
    """``"search"`` / ``"detail"`` when the expected embedded JSON is usable,
    else ``None``. ``expect`` restricts the check to one kind."""
    if not html:
        return None
    if expect in (None, "search"):
        try:
            parsed = parse_search_page(html)
            if parsed.listings:
                return "search"
        except ValueError:
            pass
    if expect in (None, "detail"):
        if extract_detail_property(html) is not None:
            return "detail"
    return None


@dataclass
class FetchPage:
    url: str
    status: int
    final_url: str
    html: str
    fetched_at: str
    error: str | None = None
    challenged: bool = False
    blocked: bool = False
    waited_s: float = 0.0
    attempts: int = 1
    audit: list = field(default_factory=list)


class BrowserSession:
    """One headed Chromium context; single flight, paced, resumable cookies."""

    def __init__(self, profile_dir, proxy=None, headless=False, min_delay=2.5,
                 timeout=60_000, solve_timeout=300, block_assets=True,
                 on_event=None, proxy_factory=None):
        self.profile_dir = str(profile_dir)
        self.proxy = proxy
        self._proxy_factory = proxy_factory
        self._rotations = 0
        self.headless = bool(headless)
        self.min_delay = float(min_delay)
        self.timeout = int(timeout)
        self.solve_timeout = int(solve_timeout)
        self.block_assets = bool(block_assets)
        self.on_event = on_event or (lambda *_a, **_k: None)
        self._pw = None
        self._ctx = None
        self._page = None
        self._last_start = 0.0

    # --- lifecycle -----------------------------------------------------------

    def start(self):
        if self._ctx is not None:
            return self
        self._pw = sync_playwright().start()
        self._ctx = self._pw.chromium.launch_persistent_context(
            self.profile_dir,
            headless=self.headless,
            proxy=self.proxy,
            viewport={"width": 1280, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            args=["--disable-blink-features=AutomationControlled"],
        )
        if self.block_assets:
            self._ctx.route("**/*", self._route)
        self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        return self

    @staticmethod
    def _route(route):
        request = route.request
        if request.resource_type in BLOCKED_RESOURCE_TYPES:
            return route.abort()
        if any(part in request.url for part in BLOCKED_HOST_PARTS):
            return route.abort()
        return route.continue_()

    def close(self):
        try:
            if self._ctx is not None:
                self._ctx.close()
        finally:
            if self._pw is not None:
                self._pw.stop()
            self._ctx = None
            self._pw = None
            self._page = None

    def rotate(self):
        """Move to a fresh residential exit: clear the old IP's cookies, relaunch.

        A solved PerimeterX clearance is bound to one IP; carrying it to a new
        exit is worse than starting clean, so cookies are cleared first.
        Returns the rotation number, or ``None`` when no factory was given.
        """
        if self._proxy_factory is None:
            return None
        self._rotations += 1
        new_proxy = self._proxy_factory(self._rotations)
        if not new_proxy:
            return None
        try:
            if self._ctx is not None:
                self._ctx.clear_cookies()
        except PlaywrightError:
            pass
        self.close()
        self.proxy = new_proxy
        self.start()
        return self._rotations

    def __enter__(self):
        return self.start()

    def __exit__(self, *_exc):
        self.close()

    # --- challenge handling --------------------------------------------------

    def _pace(self):
        wait = self.min_delay - (time.monotonic() - self._last_start)
        wait += random.uniform(0, 0.6)
        if wait > 0:
            time.sleep(wait)

    def _challenge_visible(self):
        page = self._page
        try:
            title = (page.title() or "").lower()
        except PlaywrightError:
            title = ""
        if any(marker in title for marker in CHALLENGE_TITLE):
            return True
        try:
            body = page.evaluate(
                "() => (document.body && document.body.innerText || '').slice(0, 4000).toLowerCase()"
            )
        except PlaywrightError:
            body = ""
        return any(marker in body for marker in CHALLENGE_TEXT)

    def _solvable(self):
        """True only when the page actually offers a human widget to solve.

        PerimeterX serves a bare "Access to this page has been denied" block
        with no press-and-hold element when it is confident about the client;
        no amount of clicking clears those — only a new IP does.
        """
        page = self._page
        try:
            selector = ("#px-captcha, iframe[src*='captcha'], "
                        "iframe[src*='px-cdn'], [id*='px-captcha']")
            if page.locator(selector).count():
                return True
        except PlaywrightError:
            pass
        try:
            body = page.evaluate(
                "() => (document.body && document.body.innerText || '').slice(0, 4000).toLowerCase()"
            )
        except PlaywrightError:
            body = ""
        return any(marker in body for marker in ("press & hold", "verify you are human"))

    def _diagnostics(self):
        page = self._page
        try:
            title = (page.title() or "")[:80]
        except PlaywrightError:
            title = "?"
        try:
            frames = page.locator("iframe").count()
            body = page.evaluate(
                "() => (document.body && document.body.innerText || '').replace(/\\s+/g,' ').slice(0,180)"
            )
        except PlaywrightError:
            frames, body = -1, "?"
        return f"title={title!r} iframes={frames} text={body!r}"

    def _notify(self, url, solvable):
        self.on_event("challenge", url)
        print("\n" + "=" * 72, flush=True)
        if solvable:
            print("  ZILLOW CHALLENGE — solve it in the browser window", flush=True)
            print(f"  {url}", flush=True)
            print(f"  Hold the button until it completes (~5-10 s). "
                  f"Waiting up to {self.solve_timeout // 60} min.", flush=True)
        else:
            print("  HARD BLOCK — no CAPTCHA widget to solve on this page", flush=True)
            print(f"  {url}", flush=True)
            print("  This IP is flagged. Rotating to a fresh exit automatically.", flush=True)
        print(f"  {self._diagnostics()}", flush=True)
        print("=" * 72, flush=True)
        try:
            subprocess.run(
                ["notify-send", "Zillow CAPTCHA",
                 "Solve it in the browser window" if solvable
                 else "Hard block — rotating IP automatically"],
                timeout=3, check=False, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.SubprocessError):
            pass

    def _wait_for_human(self, expect):
        """Poll until the expected payload appears or the budget runs out."""
        page = self._page
        try:
            page.bring_to_front()
        except PlaywrightError:
            pass
        started = time.monotonic()
        while time.monotonic() - started < self.solve_timeout:
            page.wait_for_timeout(2000)
            try:
                html = page.content()
            except PlaywrightError:
                continue
            if page_payload_kind(html, expect=expect):
                return html, time.monotonic() - started
            if not self._challenge_visible():
                # Challenge is gone but no payload yet: one refresh, then keep
                # polling (Zillow occasionally returns a stale shell).
                try:
                    page.reload(wait_until="domcontentloaded", timeout=self.timeout)
                except (PlaywrightError, PlaywrightTimeout):
                    pass
        return None, time.monotonic() - started

    # --- fetch ---------------------------------------------------------------

    def fetch(self, url, expect=None, max_attempts=2):
        self.start()
        page = self._page
        audit = []
        challenged = False
        blocked = False
        waited = 0.0
        status = -1
        error = None
        for attempt in range(1, max_attempts + 1):
            self._pace()
            self._last_start = time.monotonic()
            fetched_at = utc_now_iso()
            try:
                response = page.goto(url, wait_until="domcontentloaded",
                                     timeout=self.timeout)
                status = int(response.status) if response else -1
                page.wait_for_timeout(500)
                _dismiss_notice(page)
                html = page.content()
                if not page_payload_kind(html, expect=expect) and not self._challenge_visible():
                    # Ads/late hydration can delay the shell: one short grace
                    # period, never a long networkidle wait on every page.
                    try:
                        page.wait_for_load_state("networkidle", timeout=2500)
                    except PlaywrightTimeout:
                        pass
                    html = page.content()
            except (PlaywrightError, PlaywrightTimeout) as exc:
                error = scrub_secrets(f"{type(exc).__name__}: {exc}")
                status = -1
                audit.append({"url": url, "status": status, "fetched_at": fetched_at})
                time.sleep(min(10 * attempt, 20))
                continue

            audit.append({"url": url, "status": status, "fetched_at": fetched_at})
            kind = page_payload_kind(html, expect=expect)
            if kind:
                return FetchPage(url=url, status=status, final_url=page.url,
                                 html=html, fetched_at=fetched_at,
                                 error=error, challenged=challenged,
                                 waited_s=waited, attempts=attempt, audit=audit)
            if self._challenge_visible():
                challenged = True
                solvable = self._solvable()
                self._notify(page.url, solvable)
                if not solvable:
                    blocked = True
                    error = "hard block (no CAPTCHA widget) — needs a new IP"
                    break
                html, spent = self._wait_for_human(expect)
                waited += spent
                if html is not None:
                    status = 200
                    return FetchPage(url=url, status=status, final_url=page.url,
                                     html=html, fetched_at=fetched_at,
                                     error=None, challenged=True,
                                     waited_s=waited, attempts=attempt,
                                     audit=audit)
                error = "challenge not solved within budget"
                blocked = True
            else:
                error = f"no {expect or 'known'} payload (HTTP {status})"
            if attempt < max_attempts:
                time.sleep(5 * attempt)
        return FetchPage(url=url, status=status, final_url=page.url, html="",
                         fetched_at=utc_now_iso(), error=error,
                         challenged=challenged, blocked=blocked,
                         waited_s=waited, attempts=max_attempts, audit=audit)
