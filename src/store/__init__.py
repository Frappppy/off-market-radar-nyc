"""WHAT:      Stage 3 (store) of the Off-Market Real Estate Deal Finder —
           load cleaned listings into Postgres via idempotent upserts.
WHY:        The cleaned stage must land in the contract schema (listings /
           listing_snapshots / pipeline_runs) with re-runs safe: every write
           is an ON CONFLICT upsert and stale listings get marked inactive.
INPUTS:     ``jobs/<run_id>/cleaned`` (parquet preferred, csv fallback, plus
           ``manifest.json``) and ``DATABASE_URL`` (env / gitignored config).
OUTPUTS:    Upserted rows in Postgres; ``store/manifest.json`` +
           ``process_log.md``; process exit code (0/1/2).
CALLERS:    ``python -m src.store`` (``src.store.__main__`` -> ``cli.main``).
TESTED BY:  ``tests/test_store_flow.py`` (success + failure CLI flows).
Contract: docs/data_contract.md § "Stage 3 — SQL".
CLI: python -m src.store --in jobs/<run_id>/cleaned   (requires DATABASE_URL)
     python -m src.store --record-failure --run-id <id> --note "why it died"
"""

__all__ = ["StoreError"]


class StoreError(Exception):
    """Expected, user-facing failure (bad input, missing config, validation)."""
