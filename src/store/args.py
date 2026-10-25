"""WHAT:      Argument parser for ``python -m src.store`` — load mode (``--in``)
           and the orchestrator's ``--record-failure`` mode.
WHY:        Split (phase 2) from the 217-line ``store/cli.py`` (gate fix: no
           file >200 lines); body moved verbatim and re-imported by ``cli``,
           so ``cli.parse_args`` and ``python -m src.store --help`` are
           unchanged. ``--record-failure`` exists because a run that dies in
           stage 1 or 2 never reaches this stage, and without it the failure
           would be invisible to ``pipeline_runs`` / ``/api/health``.
INPUTS:     ``argv`` (defaults to ``sys.argv[1:]`` when None).
OUTPUTS:    ``argparse.Namespace``: ``input_dir``, ``output_dir``, ``run_id``,
            ``skip_schema``, ``record_failure``, ``note``, ``source``.
CALLERS:    ``src.store.cli`` (``parse_args``, also in its ``__all__``).
TESTED BY:  ``tests/test_store_cli.py`` — ``test_load_mode_without_in_is_a_config_error``,
           ``test_record_failure_mode_requires_a_run_id``.
"""

from __future__ import annotations

import argparse

_PROG = "python -m src.store"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog=_PROG,
        description=(
            "Stage 3: upsert cleaned listings into Postgres (idempotent), or "
            "with --record-failure just mark one run_id as failed."
        ),
    )
    parser.add_argument(
        "--in",
        dest="input_dir",
        default=None,
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
    # --- failure-recording mode (used by scripts/run_daily.py) ---------------
    parser.add_argument(
        "--record-failure",
        action="store_true",
        help="write a pipeline_runs row with status='failed' and exit; reads no input files",
    )
    parser.add_argument(
        "--note",
        default=None,
        help="with --record-failure: what went wrong (redacted, capped at 1000 chars)",
    )
    parser.add_argument(
        "--source",
        default=None,
        help="with --record-failure: pipeline_runs.source (e.g. 'zillow')",
    )
    # `--in` is required in load mode only, so argparse cannot declare it;
    # cli.main turns the gap into the usual exit-2 config error.
    # Verified by: test_load_mode_without_in_is_a_config_error
    return parser.parse_args(argv)
