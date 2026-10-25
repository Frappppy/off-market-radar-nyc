"""WHAT:      src/common guards — the shared primitives every stage reuses:
           text_to_bool token sets and unknown policies (stage-2 permissive
           vs stage-3 strict), write_manifest bytes (indent=2, trailing
           newline), append_log newline normalisation.
WHY:       Phase 1 deduplicated two differing implementations into these
           modules; these tests are the anchors their ``Verified by:`` lines
           point at (the modules had no direct coverage before).
INPUTS:    tmp_path only — no clock, no network, no repo files.
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
"""

import pytest

from src.common.coerce import (
    FALSE_TOKENS_STRICT,
    TRUE_TOKENS_PERMISSIVE,
    TRUE_TOKENS_STRICT,
    text_to_bool,
)
from src.common.evidence import append_log, write_manifest


def test_text_to_bool_permissive_unknown_is_false():
    """Stage-2 policy: anything outside the true-set reads as False."""
    assert text_to_bool(" YES ", true_tokens=TRUE_TOKENS_PERMISSIVE) is True
    assert text_to_bool("maybe", true_tokens=TRUE_TOKENS_PERMISSIVE) is False


def test_text_to_bool_strict_tokens():
    """Stage-3 policy: both token sets are matched, case/whitespace-insensitive."""
    tokens = dict(true_tokens=TRUE_TOKENS_STRICT, false_tokens=FALSE_TOKENS_STRICT)
    assert text_to_bool("T", **tokens) is True
    assert text_to_bool("0", **tokens) is False


def test_text_to_bool_strict_raises_on_unknown():
    tokens = dict(
        true_tokens=TRUE_TOKENS_STRICT,
        false_tokens=FALSE_TOKENS_STRICT,
        on_unknown="raise",
    )
    with pytest.raises(ValueError, match="cannot interpret"):
        text_to_bool("maybe", **tokens)


def test_write_manifest_bytes(tmp_path):
    path = write_manifest(tmp_path, {"stage": "clean"})
    assert path.name == "manifest.json"
    assert path.read_bytes() == b'{\n  "stage": "clean"\n}\n'  # indent=2 + trailing \n


def test_append_log_normalizes_newlines(tmp_path):
    log = tmp_path / "process_log.md"
    append_log(log, ["a", "b"])  # list input -> one block
    append_log(log, "c\n\n")  # stray trailing newlines collapsed to one
    assert log.read_text(encoding="utf-8") == "a\nb\nc\n"
