"""Stage 3 — store: load cleaned listings into Postgres (idempotent upserts).

Contract: docs/data_contract.md § "Stage 3 — SQL".
CLI: python -m src.store --in jobs/<run_id>/cleaned   (requires DATABASE_URL)
"""

__all__ = ["StoreError"]


class StoreError(Exception):
    """Expected, user-facing failure (bad input, missing config, validation)."""
