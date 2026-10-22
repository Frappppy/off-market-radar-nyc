"""WHAT:      Stage 2 (clean) of the Off-Market Real Estate Deal Finder — raw
            JSONL (stage 1) -> typed, motivation-scored parquet + csv
            (docs/data_contract.md).
WHY:        The package body is deliberately empty: nothing imports ``from
            src.clean import <name>`` (the re-export surface was dead code,
            deleted in phase 1); import the module you need instead
            (``cli``, ``score``, ``frame``, ``derive``, ``processlog``).
INPUTS:     See each submodule.
OUTPUTS:    ``listings_<snapshot_date>.parquet`` + ``.csv`` + manifest +
            process_log under ``jobs/<run_id>/cleaned``.
CALLERS:    ``scripts/run_daily.py`` (via ``python -m src.clean``).
TESTED BY:  See each submodule; nothing imports this marker directly.
"""
