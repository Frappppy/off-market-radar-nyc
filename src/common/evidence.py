"""WHAT:      Stage evidence writers — ``manifest.json`` and ``process_log.md``.
WHY:       ``store/reporting.py`` owned ``write_manifest``/``append_log`` while
           ``clean/cli.py`` inlined the identical ``json.dumps(..., indent=2)
           + "\\n"`` bytes for its manifests; one writer keeps every stage's
           manifest byte-identical (and ``src/store/reporting.py`` is deleted).
           ``utc_now``/``iso`` moved here verbatim with the rest of reporting.
INPUTS:    Output directory path, a payload dict (manifest) or text/lines
           (log); ``utc_now()`` reads the system clock.
OUTPUTS:   Writes ``<out_dir>/manifest.json`` (indent=2, trailing newline) and
           appends newline-terminated blocks to a log file; returns the
           manifest path / ``None``.
CALLERS:   ``src.store.cli`` (``utc_now``, ``iso``, ``write_manifest``,
           ``append_log``), ``src.clean.{cli,processlog}``
           (``write_manifest``).
TESTED BY: ``tests/test_store_flow.py::test_success_flow`` (manifest
           content), ``tests/test_clean.py::test_cli_writes_identical_csv_and_parquet``
           (manifest keys), ``tests/test_common.py::test_write_manifest_bytes``
           + ``::test_append_log_normalizes_newlines`` (exact bytes).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.isoformat(timespec="seconds")


def write_manifest(out_dir: Path, payload: dict) -> Path:
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def append_log(log_path: Path, text: str | list[str]) -> None:
    if isinstance(text, list):
        text = "\n".join(str(line) for line in text)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(text.rstrip("\n") + "\n")
