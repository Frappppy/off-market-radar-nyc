#!/usr/bin/env python3
"""Daily pipeline orchestrator — Stage 1 scrape -> Stage 2 clean -> Stage 3 store.

    py -3 scripts/run_daily.py [--skip-scrape] [--pages 30] [--max-details 120] [--delay 5]

- run_id = UTC timestamp YYYYMMDD-HHMMSS; data + run_log.md land in jobs/<run_id>/.
- config/*.local.env (gitignored) are loaded into the environment first and never
  override variables already set (CI secrets win).
- Every stage runs with THIS interpreter (sys.executable) via subprocess; a failing
  stage skips the remaining stages and the script exits non-zero.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Daily-run volume policy — a defensible portfolio-scale sample, NOT bulk.
#: The request budget is deliberately about the SAME as the original
#: 5-search-page / 150-detail default (~155 requests); it is just spent where it
#: buys coverage. A search page returns ~41 cards in ONE request, a detail page
#: returns ONE listing in one request — so pages are ~41x cheaper per listing.
#: 30 pages is therefore ~1.2k listings (roughly 5% of Zillow's ~22.8k NYC
#: actives, spread across the city) for the load the old default spent on 82.
#: The 120 detail fetches enrich the most promising rows first: the scraper
#: prioritises site-flagged "Price cut" listings, and `price_drop_pct` — which
#: drives the High score — only exists for enriched rows. Everything else still
#: carries days-on-market from its search card, which is enough for Medium.
#: Pacing is 5s between ALL requests: 2.5x the contractual 2s floor (which stays
#: the hard floor in src/scrape/cli.py). Rationale: docs/robots_precheck.md.
DAILY_PAGES = 30
DAILY_MAX_DETAILS = 120
DAILY_DELAY = 5.0


def utc_run_id(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")


def _load_env_fallback(path: Path) -> None:
    """Minimal KEY=VALUE reader — only used when python-dotenv is unavailable."""
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_local_env(root: Path = ROOT) -> list[Path]:
    """Load every gitignored config/*.local.env (no override of real env)."""
    try:
        from dotenv import load_dotenv  # contract: python-dotenv
    except ImportError:  # bare interpreter (no venv): keep --help usable
        load_dotenv = None
    loaded = []
    for path in sorted((root / "config").glob("*.local.env")):
        if load_dotenv is not None:
            load_dotenv(path, override=False)
        else:
            _load_env_fallback(path)
        loaded.append(path)
    return loaded


def latest_raw_dir(root: Path = ROOT) -> Path | None:
    """Most recent jobs/<run_id>/raw with listings.jsonl (run_id sorts chronologically)."""
    candidates = [
        d for d in root.glob("jobs/*/raw") if (d / "listings.jsonl").is_file()
    ]
    return max(candidates, key=lambda d: d.parent.name) if candidates else None


@dataclass
class Stage:
    name: str
    cmd: list[str]
    skip_reason: str | None = None  # intentional skip (--skip-scrape)


def build_stages(
    run_id: str,
    *,
    skip_scrape: bool = False,
    raw_dir: Path | None = None,
    pages: int = DAILY_PAGES,
    max_details: int = DAILY_MAX_DETAILS,
    delay: float = DAILY_DELAY,
    root: Path = ROOT,
) -> list[Stage]:
    cleaned_in = f"jobs/{run_id}/cleaned"
    if skip_scrape:
        if raw_dir is None:
            raise SystemExit(
                "--skip-scrape given but no jobs/*/raw/listings.jsonl exists yet"
            )
        raw_in = raw_dir.relative_to(root).as_posix()
        scrape = Stage("scrape", [], skip_reason=f"--skip-scrape (reusing {raw_in})")
    else:
        raw_in = f"jobs/{run_id}/raw"
        scrape = Stage(
            "scrape",
            [
                sys.executable, "-m", "src.scrape",
                "--pages", str(pages),
                "--max-details", str(max_details),
                "--delay", str(delay),
                "--out", raw_in,
            ],
        )
    return [
        scrape,
        Stage(
            "clean",
            [sys.executable, "-m", "src.clean", "--in", raw_in, "--out", cleaned_in],
        ),
        Stage("store", [sys.executable, "-m", "src.store", "--in", cleaned_in]),
    ]


def run_pipeline(stages: list[Stage], run_id: str, root: Path = ROOT) -> int:
    jobs_dir = root / "jobs" / run_id
    jobs_dir.mkdir(parents=True, exist_ok=True)
    log_path = jobs_dir / "run_log.md"
    started = datetime.now(timezone.utc)
    results: dict[str, str] = {}
    first_failure: str | None = None

    with log_path.open("w", encoding="utf-8") as log:
        def emit(text: str = "") -> None:
            log.write(text + "\n")
            print(text, flush=True)

        emit(f"# Daily pipeline - run `{run_id}`")
        emit()
        emit(f"- started_at: {started.isoformat(timespec='seconds')}")
        emit(f"- interpreter: `{sys.executable}`")
        emit(f"- python: {sys.version.split()[0]}")
        emit(f"- repo: `{root}`")
        emit()

        for index, stage in enumerate(stages, start=1):
            heading = f"## Stage {index}: {stage.name}"
            if stage.skip_reason:
                results[stage.name] = f"skipped ({stage.skip_reason})"
                emit(heading)
                emit(f"- SKIPPED: {stage.skip_reason}")
                emit()
                continue
            if first_failure:
                results[stage.name] = f"skipped (earlier stage `{first_failure}` failed)"
                emit(heading)
                emit(f"- SKIPPED: earlier stage `{first_failure}` failed")
                emit()
                continue

            emit(heading)
            emit(f"- command: `{' '.join(stage.cmd)}`")
            stage_started = datetime.now(timezone.utc)
            emit(f"- started_at: {stage_started.isoformat(timespec='seconds')}")
            emit()
            emit("```text")
            proc = subprocess.Popen(
                stage.cmd,
                cwd=root,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                log.write(line)
                sys.stdout.write(line)
            exit_code = proc.wait()
            emit("```")
            stage_finished = datetime.now(timezone.utc)
            emit(f"- finished_at: {stage_finished.isoformat(timespec='seconds')}")
            emit(f"- exit code: {exit_code}")
            emit()
            if exit_code == 0:
                results[stage.name] = "success"
            else:
                results[stage.name] = f"failed (exit {exit_code})"
                first_failure = stage.name

        emit("## Summary")
        emit()
        emit("| stage | result |")
        emit("|---|---|")
        for stage in stages:
            emit(f"| {stage.name} | {results[stage.name]} |")
        emit()
        finished = datetime.now(timezone.utc)
        overall = "success" if first_failure is None else f"failed (`{first_failure}`)"
        emit(f"- finished_at: {finished.isoformat(timespec='seconds')}")
        emit(f"- overall: {overall}")
        emit(f"- log: `jobs/{run_id}/run_log.md`")

    return 0 if first_failure is None else 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="scripts/run_daily.py",
        description="Run scrape -> clean -> store for one daily run (UTC run_id).",
    )
    parser.add_argument(
        "--skip-scrape",
        action="store_true",
        help="reuse the newest existing jobs/*/raw (no scraping), for testing",
    )
    parser.add_argument("--pages", type=int, default=DAILY_PAGES, help="search pages for src.scrape")
    parser.add_argument("--max-details", type=int, default=DAILY_MAX_DETAILS, help="detail page cap for src.scrape")
    parser.add_argument(
        "--delay",
        type=float,
        default=DAILY_DELAY,
        help="minimum seconds between requests (src.scrape floors this at 2s)",
    )
    parser.add_argument("--run-id", default=None, help="override the generated UTC run_id")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    run_id = args.run_id or utc_run_id()
    loaded = load_local_env(ROOT)
    raw_dir = latest_raw_dir(ROOT) if args.skip_scrape else None
    try:
        stages = build_stages(
            run_id,
            skip_scrape=args.skip_scrape,
            raw_dir=raw_dir,
            pages=args.pages,
            max_details=args.max_details,
            delay=args.delay,
        )
    except SystemExit as exc:
        print(f"run_daily: ERROR: {exc}", file=sys.stderr)
        return 1
    if loaded:
        print(f"run_daily: loaded env files: {', '.join(p.name for p in loaded)}")
    print(f"run_daily: run_id={run_id}")
    return run_pipeline(stages, run_id, ROOT)


if __name__ == "__main__":
    sys.exit(main())
