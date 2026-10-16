"""CLI for stage 1 (scrape): ``python -m src.scrape`` (docs/data_contract.md).

    py -3 -m src.scrape --pages 5 --max-details 150 --out jobs/<run_id>/raw

Exit code 0 = success; a PerimeterX/CAPTCHA challenge or any fatal error
exits 1 with ``manifest.json`` ``status="failed"`` and a reason.
"""

from __future__ import annotations

import argparse
import sys

from .config import DEFAULT_DELAY, DEFAULT_MAX_DETAILS, DEFAULT_PAGES
from .pipeline import ScrapeRun

#: hard pacing floor from the contract — never lowered, even via --delay
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
    delay = max(MIN_DELAY, args.delay)  # >=2s between ALL requests (hard rule)
    run = ScrapeRun(
        out_dir=args.out_path,
        pages=args.pages,
        max_details=args.max_details,
        delay=delay,
    )
    return run.run()


if __name__ == "__main__":
    sys.exit(main())
