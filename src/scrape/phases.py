"""WHAT:      The two scrape phases — city search pages (follow
           ``pagination.nextUrl``) and detail-page enrichment, plus the
           ``SearchFetch`` audit row and the detail-target ordering rule.
WHY:        Split (phase 2) from the 481-line ``pipeline.py``; run state and
           guards live in ``run.py``, artifact writers in ``artifacts.py``
           (this module is a mixin class — bodies moved verbatim).
INPUTS:     ``ScrapeRun`` state via ``self`` (records, caps, client).
OUTPUTS:    Fills ``self.records`` / ``self.search_pages`` / ``self.notes``;
            raises ``RunError`` (defined here so ``run.py`` can import it
            without a cycle) on an unparseable/failed first search page.
CALLERS:    ``src.scrape.run.ScrapeRun`` (``PhasesMixin`` base class).
TESTED BY:  ``tests/test_scrape.py::test_detail_targets_price_cuts_first``
           (detail ordering); search-phase failure paths untested (REPO_MAP §10.4).
"""

from __future__ import annotations

from collections import deque

from ..common.timeutil import utc_now_iso
from .config import DEFAULT_PAGE_URLS
from .parsing import (
    build_record,
    extract_detail_property,
    extract_json_ld,
    parse_search_page,
)
from .robots import is_allowed_url

# --- run-level error + search-page audit row --------------------------------


class RunError(RuntimeError):
    """Fatal, run-level failure with a human-readable reason."""


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


# --- phases (ScrapeRun mixin) -----------------------------------------------


class PhasesMixin:
    """Search + detail phases; expects the ``ScrapeRun`` state contract."""

    # --- search phase --------------------------------------------------------

    def _merge_search_card(self, item: dict) -> None:
        zpid_raw = item.get("zpid")
        if zpid_raw is None:
            return
        zpid = str(zpid_raw)
        if zpid in self.records:
            return  # seen on an earlier page (inventory drift across pages)
        record = build_record(
            item, None, None, None, scraped_at=utc_now_iso()
        )
        if record is None:
            self.unusable_cards += 1
            return
        self.records[zpid] = record
        self.search_rows[zpid] = item

    def _search_phase(self) -> None:
        queue = deque([self.start_url])
        seeds = [u for u in DEFAULT_PAGE_URLS if u != self.start_url]
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
                parsed = parse_search_page(result.text)
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

    # --- detail phase --------------------------------------------------------

    def _detail_targets(self) -> list[str]:
        """zpid list under the cap: site-flagged price cuts first (the deal
        signal this project exists for); Verified by: test_detail_targets_price_cuts_first"""
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
            prop = extract_detail_property(result.text)
            json_ld = extract_json_ld(result.text)
            if prop is None and json_ld is None:
                self.detail_skipped.append(zpid)
                self.notes.append(
                    f"detail zpid {zpid}: no embedded JSON (kept search-card fields)"
                )
                continue
            merged = build_record(
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
