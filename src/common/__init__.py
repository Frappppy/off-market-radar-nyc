"""WHAT:      Package marker for ``src.common`` — shared primitives for the
           three pipeline stages (phase-1 dedupe target). It intentionally
           imports none of its submodules, so a stage pulls in exactly the
           helper it needs.
WHY:       ``runid``/``timeutil``/``evidence``/``coerce`` existed as drifting
           copies inside each stage; one owner per rule lives here so the
           stages cannot disagree again.
INPUTS:    Nothing (no side effects, no configuration, no clock at import).
OUTPUTS:   Nothing.
CALLERS:   ``src.scrape`` (http, run, artifacts, phases), ``src.clean``
           (cli, score, processlog), ``src.store`` (cli, scalars) via
           ``from ..common.<module> import``.
TESTED BY: nothing directly (marker only; every submodule carries its own
           anchors).
"""
