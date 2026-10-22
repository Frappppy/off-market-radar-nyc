"""WHAT:      CLI for stage 1 (scrape): ``python -m src.scrape``
            (docs/data_contract.md).

    py -3 -m src.scrape --pages 5 --max-details 150 --out jobs/<run_id>/raw

WHY:        Argparse-only driver; every run behaviour lives in
            ``run.ScrapeRun``, so this file never grows logic.
INPUTS:     ``argv``: ``--pages`` / ``--max-details`` / ``--out`` / ``--delay``.
OUTPUTS:    Exit code 0 = success; a PerimeterX/CAPTCHA challenge or any fatal
            error exits 1 with ``manifest.json`` ``status="failed"`` + reason.
CALLERS:    ``src.scrape.__main__`` (``python -m src.scrape``),
            ``scripts/run_daily.py``.
TESTED BY:  ``tests/test_scrape.py::test_cli_defaults_match_contract``
            (defaults 5/150, ``MIN_DELAY`` floor — I7).
"""

from __future__ import annotations

import argparse

from .config import DEFAULT_DELAY, DEFAULT_MAX_DETAILS, DEFAULT_PAGES
from .run import ScrapeRun

#: hard pacing floor from the contract — never lowered, even via --delay.
#: Verified by: test_cli_defaults_match_contract
MIN_DELAY = 2.0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m src.scrape",
        description=(
            "Stage 1 (scrape): Zillow NYC search + detail pages -> "
            "listings.jsonl (+ pages_fetched.json, manifest.json, process_log.md)"
        ),
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=DEFAULT_PAGES,
        metavar="N",
        help=f"search pages to fetch (default: {DEFAULT_PAGES}, contract cap)",
    )
    parser.add_argument(
        "--max-details",
        dest="max_details",
        type=int,
        default=DEFAULT_MAX_DETAILS,
        metavar="N",
        help=(
            "detail pages to fetch (default: "
            f"{DEFAULT_MAX_DETAILS}, contract cap; 0 = search cards only)"
        ),
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        required=True,
        metavar="DIR",
        help="raw output dir (jobs/<run_id>/raw)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        metavar="SEC",
        help=(
            f"minimum seconds between requests (default: {DEFAULT_DELAY:g}; "
            f"floored at {MIN_DELAY:g} by the pacing rule)"
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.pages < 1:
        parser.error("--pages must be >= 1")
    if args.max_details < 0:
        parser.error("--max-details must be >= 0")
    delay = max(MIN_DELAY, args.delay)  # >=2s between ALL requests: Verified by test_cli_defaults_match_contract
    run = ScrapeRun(
        out_dir=args.out_path,
        pages=args.pages,
        max_details=args.max_details,
        delay=delay,
    )
    return run.run()
