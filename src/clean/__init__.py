"""Stage 2 (clean) of the Off-Market Real Estate Deal Finder.

Raw JSONL (stage 1) -> typed, motivation-scored parquet + csv (docs/data_contract.md).
"""

from .cli import main
from .core import (
    DERIVED_COLUMNS,
    RAW_COLUMNS,
    CleanStats,
    build_frame,
    clean_file,
    pick_snapshot_date,
    read_jsonl,
    score_one,
    transform,
)

__all__ = [
    "DERIVED_COLUMNS",
    "RAW_COLUMNS",
    "CleanStats",
    "build_frame",
    "clean_file",
    "main",
    "pick_snapshot_date",
    "read_jsonl",
    "score_one",
    "transform",
]
