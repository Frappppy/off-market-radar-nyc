"""WHAT:      Stage-1 artifact writers — ``listings.jsonl``,
            ``pages_fetched.json``, ``manifest.json``, ``process_log.md``, and
            the ``_finalize`` step that writes all four for either outcome.
WHY:        Split (phase 2) from the 481-line ``pipeline.py``; run state and
            guards live in ``run.py``, the phases in ``phases.py`` (this module
            is a mixin class — bodies moved verbatim).
INPUTS:     ``ScrapeRun`` state via ``self`` (records, counters, status, times);
            ``resolve_run_id`` takes the raw output-dir path.
OUTPUTS:    The four contract files under ``self.out_dir``; the run id derived
            from ``out_dir``.
CALLERS:    ``src.scrape.run.ScrapeRun`` (``ArtifactsMixin`` base class);
            ``src.scrape.run.resolve_run_id`` is this function re-exported for
            ``tests/test_scrape.py`` (moved verbatim in the phase-2 gate fix —
            run.py was 4 lines over the 200-line cap).
TESTED BY:  NOTHING directly (no pytest covers the writers or the run
            manifest — scrape enforcement-loop gap, REPO_MAP §10.4).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..common import runid
from ..common.timeutil import utc_now_iso
from .config import IMPERSONATE
from .proxy import proxy_display
from .robots import ROBOTS_SNAPSHOT

# --- run-id helper -----------------------------------------------------------


def resolve_run_id(out_dir: Path) -> str:
    """``jobs/<run_id>/raw`` -> <run_id>, else current UTC timestamp."""
    return runid.resolve_run_id(
        dir_run_id=runid.run_id_from_dir(out_dir.parent),
        fallback=runid.utc_stamp(),
    )


# --- artifact writers (ScrapeRun mixin) --------------------------------------


class ArtifactsMixin:
    """Artifact writers; expects the ``ScrapeRun`` state contract."""

    if TYPE_CHECKING:
        out_dir: Path
        records: dict[str, dict]
        unusable_cards: int
        run_id: str
        started_at: str
        finished_at: str | None
        status: str
        reason: str | None
        pages: int
        max_details: int
        delay: float
        start_url: str
        search_pages: list[Any]
        detail_attempted: int
        detail_ok: int
        detail_skipped: list[str]
        notes: list[str]
        _session: str | None

        def _audit(self) -> list[dict]: ...

    def _write_jsonl(self) -> Path:
        path = self.out_dir / "listings.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for record in self.records.values():
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        return path

    def _write_pages_fetched(self) -> Path:
        path = self.out_dir / "pages_fetched.json"
        path.write_text(
            json.dumps(self._audit(), indent=2) + "\n", encoding="utf-8",
            newline="\n"
        )
        return path

    def _manifest(self) -> dict:
        return {
            "stage": "scrape",
            "run_id": self.run_id,
            # distinct zpid cards discovered on search pages (incl. unusable;
            # counting rule untested — see header)
            "records_in": len(self.records) + self.unusable_cards,
            "records_out": len(self.records),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "status": self.status,
            "reason": self.reason,
        }

    def _write_manifest(self) -> Path:
        path = self.out_dir / "manifest.json"
        path.write_text(json.dumps(self._manifest(), indent=2) + "\n", encoding="utf-8",
                        newline="\n")
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
        path.write_text(self._process_log(), encoding="utf-8", newline="\n")
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
