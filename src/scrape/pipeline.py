"""Stage 1 pipeline: paced, single-flight, robots-safe Zillow scrape.

Flow: city search pages (embedded JSON -> follow ``pagination.nextUrl``) ->
enrich up to ``--max-details`` listing detail pages -> write the contract
artifacts (``listings.jsonl``, ``pages_fetched.json``, ``manifest.json``,
``process_log.md``).

Hard rules enforced here (docs/data_contract.md, docs/robots_precheck.md):
* only robots-allowed zillow.com paths (``config.is_allowed_url`` gates every
  request, redirect targets are re-checked),
* >= ``delay`` seconds between requests, concurrency 1 (``http.ZillowClient``),
* 429/Retry-After: pause + retry in the client, then one sticky-session
  rotation before giving up,
* PerimeterX/CAPTCHA challenge -> abort the run, manifest ``status=failed``
  with a reason, never attempt to defeat it.
"""

from __future__ import annotations

import json
import re
from collections import deque
from pathlib import Path
from urllib.parse import urlparse

from . import config, parsers
from .config import (
    DEFAULT_DELAY,
    DEFAULT_MAX_DETAILS,
    DEFAULT_PAGES,
    DEFAULT_SESSION,
    DEFAULT_TIMEOUT,
    DISALLOWED_PATH_PREFIXES,
    IMPERSONATE,
    ROBOTS_SNAPSHOT,
    START_URL,
    build_proxy_url,
    is_allowed_url,
    proxy_display,
    scrub_secrets,
)
from .http import CaptchaBlocked, FetchResult, RateLimited, ZillowClient, utc_now_iso

MANIFEST_KEYS = (
    "stage",
    "run_id",
    "records_in",
    "records_out",
    "started_at",
    "finished_at",
    "status",
    "reason",
)

RUN_ID_RE = re.compile(r"^\d{8}-\d{6}$")

#: proxy-auth fallback + one 429 rotation, both bounded
_MAX_SESSION_ROTATIONS = 1


class RunError(RuntimeError):
    """Fatal, run-level failure with a human-readable reason."""


def resolve_run_id(out_dir: Path) -> str:
    """``jobs/<run_id>/raw`` -> <run_id>, else current UTC timestamp."""
    parent = out_dir.parent.name
    if RUN_ID_RE.match(parent):
        return parent
    return utc_now_iso().replace("-", "").replace(":", "").replace("T", "-")[:15]


class SearchFetch:
    """One fetched search page (audit row + parse results)."""

    __slots__ = ("url", "status", "fetched_at", "listings_seen", "new_records", "next_url")

    def __init__(self, url, status, fetched_at):
        self.url = url
        self.status = status
        self.fetched_at = fetched_at
        self.listings_seen = 0
        self.new_records = 0
        self.next_url = None


class ScrapeRun:
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
                raise  # abort rule: never retried, never bypassed
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

    @staticmethod
    def _guard_redirect(result: FetchResult):
        """Followed redirects must stay on allowed Zillow paths too."""
        final = result.final_url
        if not final or final.rstrip("/") == result.url.rstrip("/"):
            return
        parts = urlparse(final)
        host = (parts.hostname or "").lower()
        if host not in ("www.zillow.com", "zillow.com"):
            raise RunError(f"redirected off zillow.com to {final}")
        path = parts.path
        if path.startswith(DISALLOWED_PATH_PREFIXES):
            raise RunError(f"redirected to robots-disallowed path: {path}")

    # --- phases -------------------------------------------------------------

    def _merge_search_card(self, item: dict) -> None:
        zpid_raw = item.get("zpid")
        if zpid_raw is None:
            return
        zpid = str(zpid_raw)
        if zpid in self.records:
            return  # seen on an earlier page (inventory drift across pages)
        record = parsers.build_record(
            item, None, None, None, scraped_at=utc_now_iso()
        )
        if record is None:
            self.unusable_cards += 1
            return
        self.records[zpid] = record
        self.search_rows[zpid] = item

    def _search_phase(self) -> None:
        queue = deque([self.start_url])
        seeds = [u for u in config.DEFAULT_PAGE_URLS if u != self.start_url]
        seen_urls: set[str] = set()

        while len(self.search_pages) < self.pages:
            url = None
            while queue:
                candidate = queue.popleft()
                if candidate not in seen_urls:
                    url = candidate
                    break
            if url is None and seeds:
                url = seeds.pop(0)
                if url in seen_urls:
                    url = None
            if url is None:
                if len(self.search_pages) < self.pages:
                    self.notes.append(
                        f"search pagination exhausted after "
                        f"{len(self.search_pages)} page(s) (cap {self.pages})"
                    )
                break
            seen_urls.add(url)

            result = self._fetch(url, name=f"search-{len(self.search_pages) + 1:02d}")
            page = SearchFetch(
                url=url, status=result.status, fetched_at=result.fetched_at
            )
            self.search_pages.append(page)

            if result.status != 200 or not result.text:
                message = (
                    f"search page {len(self.search_pages)} `{url}` -> "
                    f"HTTP {result.status}"
                    + (f" ({result.error})" if result.error else "")
                )
                if len(self.search_pages) == 1:
                    raise RunError(message + " (first search page failed)")
                self.notes.append(message + " - stopping pagination, keeping earlier pages")
                break

            try:
                parsed = parsers.parse_search_page(result.text)
            except ValueError as exc:
                message = f"search page `{url}`: {exc}"
                if len(self.search_pages) == 1:
                    raise RunError(message + " (first search page unparseable)")
                self.notes.append(message + " - stopping pagination")
                break

            page.listings_seen = len(parsed.listings)
            before = len(self.records)
            for item in parsed.listings:
                self._merge_search_card(item)
            page.new_records = len(self.records) - before

            if parsed.next_url:
                next_abs = (
                    parsed.next_url
                    if parsed.next_url.startswith("http")
                    else "https://www.zillow.com" + parsed.next_url
                )
                if is_allowed_url(next_abs):
                    page.next_url = next_abs
                    queue.append(next_abs)
                else:
                    self.notes.append(
                        f"robots refused next pagination link `{parsed.next_url}`"
                    )
            if parsed.total_result_count:
                self.notes.append(
                    f"`{url}` reports {parsed.total_result_count} total results"
                )

    def _detail_targets(self) -> list[str]:
        """zpid list under the cap: site-flagged price cuts first (the deal
        signal this project exists for), then discovery order."""
        flagged = [z for z, r in self.records.items() if r.get("price_reduced")]
        rest = [z for z, r in self.records.items() if not r.get("price_reduced")]
        return (flagged + rest)[: self.max_details]

    def _detail_phase(self) -> None:
        if not self.max_details or not self.records:
            return
        targets = self._detail_targets()
        if any(r.get("price_reduced") for r in self.records.values()) and len(targets) < len(self.records):
            self.notes.append(
                "detail selection: site-flagged `Price cut` listings first, "
                "then discovery order (cap "
                f"{self.max_details}/{len(self.records)})"
            )
        for zpid in targets:
            entry = self.search_rows.get(zpid)
            record = self.records[zpid]
            self.detail_attempted += 1
            result = self._fetch(
                record["url"], name=f"detail-{self.detail_attempted:03d}-{zpid}"
            )
            if result.status != 200 or not result.text:
                self.detail_skipped.append(zpid)
                self.notes.append(
                    f"detail zpid {zpid} -> HTTP {result.status} (kept search-card fields)"
                )
                continue
            prop = parsers.extract_detail_property(result.text)
            json_ld = parsers.extract_json_ld(result.text)
            if prop is None and json_ld is None:
                self.detail_skipped.append(zpid)
                self.notes.append(
                    f"detail zpid {zpid}: no embedded JSON (kept search-card fields)"
                )
                continue
            merged = parsers.build_record(
                entry, prop, result.text, json_ld, scraped_at=utc_now_iso()
            )
            if merged is None:
                self.detail_skipped.append(zpid)
                self.notes.append(
                    f"detail zpid {zpid}: unparseable detail record (kept search-card fields)"
                )
                continue
            self.records[zpid] = merged
            self.detail_ok += 1

    # --- artifacts ----------------------------------------------------------

    def _write_jsonl(self) -> Path:
        path = self.out_dir / "listings.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for record in self.records.values():
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        return path

    def _write_pages_fetched(self) -> Path:
        path = self.out_dir / "pages_fetched.json"
        path.write_text(
            json.dumps(self._audit(), indent=2) + "\n", encoding="utf-8"
        )
        return path

    def _manifest(self) -> dict:
        return {
            "stage": "scrape",
            "run_id": self.run_id,
            # distinct zpid cards discovered on search pages (incl. unusable)
            "records_in": len(self.records) + self.unusable_cards,
            "records_out": len(self.records),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "reason": self.reason,
        }

    def _write_manifest(self) -> Path:
        path = self.out_dir / "manifest.json"
        path.write_text(json.dumps(self._manifest(), indent=2) + "\n", encoding="utf-8")
        return path

    def _process_log(self) -> str:
        lines = [
            "# process log - stage 1 (scrape)",
            "",
            f"- `run_id`: `{self.run_id}`",
            f"- `started_at`: {self.started_at}",
            f"- output dir: `{self.out_dir}`",
            "- target: zillow.com New York City (start "
            f"`{self.start_url}`)",
            f"- caps: pages={self.pages}, max_details={self.max_details}",
            f"- pacing: >= {self.delay:g}s between requests, single flight "
            f"(concurrency 1), impersonate `{IMPERSONATE}`",
            f"- proxy: {proxy_display(self._session)} (credentials from "
            "`config/dataimpulse.local.env`, never logged)",
            f"- robots: `{ROBOTS_SNAPSHOT}` - city search pages + `/homedetails/` "
            "only; `/api/`, `/graphql/`, `/search/HDPMapResults.htm` never requested",
            "",
            "## Search pages",
            "| # | url | status | fetched_at | cards | new records |",
            "|---|---|---|---|---|---|",
        ]
        for index, page in enumerate(self.search_pages, start=1):
            lines.append(
                f"| {index} | {page.url} | {page.status} | {page.fetched_at} | "
                f"{page.listings_seen} | {page.new_records} |"
            )
        lines += [
            "",
            "## Details",
            f"- attempted: {self.detail_attempted}; enriched: {self.detail_ok}; "
            f"kept search-card fields: {len(self.detail_skipped)}",
            "- parse: embedded `__NEXT_DATA__` gdpClientCache `property` first, "
            "JSON-LD fallback; site `Price cut` HTML tag used as reduced flag",
        ]
        if self.notes:
            lines += ["", "## Notes"]
            lines += [f"- {note}" for note in dict.fromkeys(self.notes)]
        lines += [
            "",
            "## Write",
            f"- `listings.jsonl` - {len(self.records)} records",
            f"- `pages_fetched.json` - {len(self._audit())} requests",
            "- `manifest.json`",
            "",
            "## Result",
            f"- `finished_at`: {self.finished_at}",
            f"- status: `{self.status}`",
        ]
        if self.reason:
            lines.append(f"- reason: {self.reason}")
        if self.status == "failed" and "PerimeterX" in (self.reason or ""):
            lines.append(
                "- PerimeterX/CAPTCHA challenge: the run was aborted immediately; "
                "the challenge was NOT attempted or bypassed (hard rule)."
            )
        lines += ["", "## Contract fields not extracted (honest gaps)"]
        lines += [
            "- `price_previous` / `price_history`: only listings that show a "
            "price cut (site `priceChange`) or ship a showcase `priceHistory` "
            "blob carry them; Zillow does not expose a prior list price for "
            "never-reduced listings, so they stay null (correct, not a bug).",
            "- `listed_date`: from detail `datePosted`/`comingSoonOnMarketDate` "
            "when present, else null (no derivation from DOM to avoid fabricating).",
            "- `property_type=co-op`: detected from detail `resoFacts`; "
            "search-card-only rows may read `condo` (Zillow's card homeType "
            "collapses co-ops into CONDO).",
            "",
        ]
        return "\n".join(lines)

    def _write_process_log(self) -> Path:
        path = self.out_dir / "process_log.md"
        path.write_text(self._process_log(), encoding="utf-8")
        return path

    def _finalize(self, status: str, reason: str | None) -> None:
        self.status = status
        self.reason = reason
        self.finished_at = utc_now_iso()
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._write_jsonl()
        self._write_pages_fetched()
        self._write_manifest()
        self._write_process_log()

    # --- run ----------------------------------------------------------------

    def run(self) -> int:
        """Execute the run; always writes artifacts. Returns process exit code."""
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
