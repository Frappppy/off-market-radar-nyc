"""WHAT:      ``RUN_ID_RE``, the UTC run-id stamp, and the one run-id policy
           (``resolve_run_id`` / ``utc_stamp`` / ``run_id_from_dir``).
WHY:       The three stages each resolved a run_id through the same
           precedence chain — explicit flag -> manifest value -> run-directory
           name -> fallback — but kept three copies with three fallbacks
           (scrape: UTC stamp · clean: ``"unknown"`` · store: parent dir, then
           UTC now). The chain lives here; every difference between the stages
           is an explicit keyword argument, so each call site's semantics stay
           exactly what they were.
INPUTS:    Keyword arguments only: the explicit ``--run-id`` flag, candidates
           extracted from the stage's own manifest/directory layout, and the
           stage's fallback string. No file or clock access except in
           ``utc_stamp()`` (system clock).
OUTPUTS:   ``resolve_run_id(...)`` -> run id string;
           ``utc_stamp()`` -> ``"YYYYMMDD-HHMMSS"`` (current UTC time);
           ``run_id_from_dir(...)`` -> directory name or ``None``.
CALLERS:   ``src.scrape.artifacts.resolve_run_id``,
           ``src.clean.cli.resolve_run_id``, ``src.store.cli.resolve_run_id``.
TESTED BY: ``tests/test_scrape.py::test_resolve_run_id_prefers_parent_dir``
           (dir candidate + UTC-stamp fallback), ``tests/test_store_cli.py::
           test_resolve_run_id_precedence`` (full 4-step chain).
"""

from __future__ import annotations

import re
from pathlib import Path

from .timeutil import utc_now_iso

#: The run-id format every stage writes: ``jobs/<YYYYMMDD-HHMMSS>/...``.
RUN_ID_RE = re.compile(r"^\d{8}-\d{6}$")


def utc_stamp() -> str:
    """Current UTC time formatted as a run id, ``YYYYMMDD-HHMMSS``."""
    return utc_now_iso().replace("-", "").replace(":", "").replace("T", "-")[:15]


def run_id_from_dir(directory: Path) -> str | None:
    """``directory.name`` when it looks like a run id, else ``None``."""
    name = directory.name
    return name if RUN_ID_RE.match(name) else None


def resolve_run_id(
    *,
    explicit: str | None = None,
    manifest_run_id: str | None = None,
    dir_run_id: str | None = None,
    fallback: str = "unknown",
) -> str:
    """Precedence shared by all stages: explicit flag -> manifest -> dir -> fallback.

    Each stage extracts its own manifest/directory candidate (their layouts
    differ) and passes its original fallback by keyword.
    """
    if explicit:
        return explicit
    if manifest_run_id:
        return manifest_run_id
    if dir_run_id:
        return dir_run_id
    return fallback
