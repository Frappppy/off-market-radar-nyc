"""WHAT:      Run orchestration for stage 1 — ``ScrapeRun`` state, proxy-client
           management, robots/redirect guards, exit codes. The search/detail
           phase bodies live in ``phases.py``, the artifact writers in
           ``artifacts.py`` (both mixin classes, moved verbatim in the
           phase-2 split of the 481-line ``pipeline.py``).
WHY:        One object owns the whole run so the hard rules below are enforced
           in exactly one place, whatever order the phases execute in.
INPUTS:     Constructor args (``out_dir``, ``pages``, ``max_details``,
           ``delay``, ``timeout``, ``session``, ``start_url``).
OUTPUTS:    ``run()`` -> process exit code; contract artifacts via
           ``ArtifactsMixin``; ``RunError`` for fatal run-level failures.
CALLERS:    ``src.scrape.cli`` (``ScrapeRun``); ``tests/test_scrape.py``
           imports ``resolve_run_id`` (re-exported here from ``artifacts.py``).
Hard rules (docs/data_contract.md, docs/robots_precheck.md), each anchored:
* only robots-allowed zillow.com paths; redirect targets re-checked —
  Verified by: test_is_allowed_url (redirect guard itself: gap, §10.4)
* >= ``delay`` seconds between requests, concurrency 1 —
  Verified by: test_cli_defaults_match_contract (pacing floor only)
* 429/Retry-After: client backoff, then one sticky-session rotation —
  Verified by: NOTHING (gap — REPO_MAP §10.4)
* CAPTCHA challenge -> abort, manifest ``status=failed``, never defeat it —
  Verified by: test_perimeterx_marker_is_detected (detection side only)
"""


from __future__ import annotations

from pathlib import Path

from .artifacts import ArtifactsMixin, resolve_run_id
from .config import (
    DEFAULT_DELAY,
    DEFAULT_MAX_DETAILS,
    DEFAULT_PAGES,
    DEFAULT_SESSION,
    DEFAULT_TIMEOUT,
    START_URL,
)
from .http import CaptchaBlocked, FetchResult, RateLimited, ZillowClient, utc_now_iso
from .phases import PhasesMixin, RunError, SearchFetch
from .proxy import build_proxy_url, scrub_secrets
from .robots import is_allowed_url, redirect_refusal

#: proxy-auth fallback + one 429 rotation, both bounded
_MAX_SESSION_ROTATIONS = 1


class ScrapeRun(ArtifactsMixin, PhasesMixin):
    def __init__(
        self,
        out_dir,
        pages=DEFAULT_PAGES,
        max_details=DEFAULT_MAX_DETAILS,
        delay=DEFAULT_DELAY,
        timeout=DEFAULT_TIMEOUT,
        session=DEFAULT_SESSION,
        start_url=START_URL,
    ):
        self.out_dir = Path(out_dir)
        self.pages = max(1, int(pages))
        self.max_details = max(0, int(max_details))
        self.delay = float(delay)
        self.timeout = float(timeout)
        self.session = session
        self.start_url = start_url

        self.run_id = resolve_run_id(self.out_dir)
        self.started_at = utc_now_iso()
        self.finished_at = None
        self.status = "running"
        self.reason = None

        self.records: dict[str, dict] = {}   # zpid -> contract record (discovery order)
        self.search_rows: dict[str, dict] = {}  # zpid -> raw search card (for merging)
        self.unusable_cards = 0
        self.search_pages: list[SearchFetch] = []
        self.detail_attempted = 0
        self.detail_ok = 0
        self.detail_skipped: list[str] = []
        self.notes: list[str] = []

        self._carried_audit: list[dict] = []
        self._session = session
        self._session_base = session  # name used if a 429 forces rotation
        self._session_rotations = 0
        self._fell_back_no_session = False
        self.client = self._new_client(self._session)

    # --- proxy client management -------------------------------------------

    def _new_client(self, sessid):
        return ZillowClient(
            build_proxy_url(sessid=sessid),
            min_delay=self.delay,
            timeout=self.timeout,
        )

    def _audit(self):
        return list(self._carried_audit) + list(self.client.audit)

    def _rotate_session(self, why: str, url: str):
        """Sticky session -> new sticky session (429) -> plain __cr.us."""
        self._carried_audit.extend(self.client.audit)
        if self._session is not None and self._session_rotations < _MAX_SESSION_ROTATIONS:
            self._session_rotations += 1
            self._session = f"{self._session_base}-{self._session_rotations + 1}"
            self.notes.append(f"rotated sticky session to `{self._session}` ({why})")
        elif self._session is not None:
            self._session = None
            self._fell_back_no_session = True
            self.notes.append(f"fell back to plain rotating exit ({why})")
        else:
            raise RunError(f"HTTP 429 persisted after session rotation on {url}")
        self.client = self._new_client(self._session)

    # --- fetching (robots + pacing + retries live below) --------------------

    def _fetch(self, url: str, name: str) -> FetchResult:
        if not is_allowed_url(url):
            raise RunError(f"refusing URL outside robots-allowed Zillow paths: {url}")
        while True:
            try:
                result = self.client.fetch(url, name=name)
            except CaptchaBlocked:
                raise  # hard rule (see header): never retried
            except RateLimited as exc:
                self._rotate_session(f"HTTP 429 persisted ({exc})", url)
                continue
            if result.status == -1 and self._looks_like_proxy_auth(result) and not self._fell_back_no_session:
                # sticky-session auth quirk -> plain __cr.us fallback (docs)
                self._carried_audit.extend(self.client.audit)
                self._session = None
                self._fell_back_no_session = True
                self.client = self._new_client(None)
                self.notes.append(
                    "sticky session rejected by proxy auth -> fell back to plain `__cr.us`"
                )
                continue
            self._guard_redirect(result)
            return result

    @staticmethod
    def _looks_like_proxy_auth(result: FetchResult) -> bool:
        text = (result.error or "").lower()
        return "407" in text or "proxy" in text and "auth" in text

    # Kept separate from robots.is_allowed_url on purpose: its semantics are a
    # strict SUPERSET of it (host + DISALLOWED_PATH_PREFIXES + snapshot denies
    # only — no https/query/shape checks), so reusing is_allowed_url here would
    # tighten the gate and break legal `?` redirects. See docs/decisions.md §2
    # and robots.redirect_refusal, which both HTTP paths now share.
    # Verified by: test_redirect_refusal
    @staticmethod
    def _guard_redirect(result: FetchResult):
        """Followed redirects must stay on allowed Zillow paths too."""
        refusal = redirect_refusal(result.url, result.final_url)
        if refusal:
            raise RunError(refusal)

    # --- run ----------------------------------------------------------------

    def run(self) -> int:
        """Execute the run; always writes artifacts. Verified by: NOTHING (gap — REPO_MAP §10.4)."""
        self.out_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._search_phase()
            if not self.records:
                raise RunError("no listings discovered on any search page")
            self._detail_phase()
        except CaptchaBlocked as exc:
            self._finalize("failed", str(exc))
            print(f"scrape aborted: {scrub_secrets(str(exc))}", flush=True)
            return 1
        except (RunError, RateLimited) as exc:
            self._finalize("failed", scrub_secrets(str(exc)))
            print(f"scrape failed: {scrub_secrets(str(exc))}", flush=True)
            return 1
        except Exception as exc:  # noqa: BLE001 - surface anything else as failed
            reason = scrub_secrets(f"{type(exc).__name__}: {exc}")
            self._finalize("failed", reason)
            print(f"scrape failed: {reason}", flush=True)
            return 1
        self._finalize("success", None)
        print(
            f"scrape: {len(self.records)} listings "
            f"({len(self.search_pages)} search page(s), "
            f"{self.detail_ok}/{self.detail_attempted} detail(s) enriched) -> "
            f"{self.out_dir / 'listings.jsonl'}",
            flush=True,
        )
        return 0
