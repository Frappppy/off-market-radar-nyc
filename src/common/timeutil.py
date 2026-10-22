"""WHAT:      ``utc_now_iso()`` — the single UTC timestamp formatter (stages 1/2).
WHY:       ``scrape/http.py`` and ``clean/core.py`` carried byte-identical
           copies (ISO-8601, second precision, ``Z`` suffix); one definition
           keeps every artifact timestamp in the same style.
INPUTS:    The system clock (``datetime.now(timezone.utc)``).
OUTPUTS:   ``"YYYY-MM-DDTHH:MM:SSZ"``, e.g. ``"2026-10-20T15:30:45Z"``.
CALLERS:   ``src.scrape.http`` (re-exported onward to ``src.scrape.run``),
           ``src.scrape.{artifacts,phases}``, ``src.clean.{cli,processlog}``,
           ``src.common.runid.utc_stamp()``.
TESTED BY: ``tests/test_clean.py::test_run_id_inferred_from_raw_manifest``
           (parses the ``Z``-suffixed style back into aware UTC).
"""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
