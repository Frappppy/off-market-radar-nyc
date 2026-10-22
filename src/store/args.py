"""WHAT:      Argument parser for ``python -m src.store``.
WHY:        Split (phase 2) from the 217-line ``store/cli.py`` (gate fix: no
           file >200 lines); body moved verbatim and re-imported by ``cli``,
           so ``cli.parse_args`` and ``python -m src.store --help`` are
           unchanged.
INPUTS:     ``argv`` (defaults to ``sys.argv[1:]`` when None).
OUTPUTS:    ``argparse.Namespace``: ``input_dir``, ``output_dir``, ``run_id``,
            ``skip_schema``.
CALLERS:    ``src.store.cli`` (``parse_args``, also in its ``__all__``).
"""

from __future__ import annotations

import argparse


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m src.store",
        description="Stage 3: upsert cleaned listings into Postgres (idempotent).",
    )
    parser.add_argument(
        "--in",
        dest="input_dir",
        required=True,
        metavar="DIR",
        help="cleaned stage output directory, e.g. jobs/<run_id>/cleaned",
    )
    parser.add_argument(
        "--out",
        dest="output_dir",
        default=None,
        metavar="DIR",
        help="evidence directory for manifest/process_log (default: <input dir>/../store)",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="pipeline_runs.run_id (default: cleaned manifest, else parent dir name, else UTC now)",
    )
    parser.add_argument(
        "--skip-schema",
        action="store_true",
        help="do not apply sql/schema.sql before loading",
    )
    return parser.parse_args(argv)
