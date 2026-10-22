"""WHAT:      ``text_to_bool()`` — one text→boolean matcher, token sets supplied
           per stage.
WHY:       Stage 2 (``clean.score._coerce_bool``) and stage 3
           (``store.mapping._bool``) parsed boolean text with different
           vocabularies and opposite unknown-handling (stage 2: any unknown
           token reads ``False``; stage 3: only ``true/t/1/yes`` and
           ``false/f/0/no`` are accepted, anything else raises). The matching
           rule is shared; each stage keeps its exact token set and unknown
           policy as keyword parameters, so both behave precisely as before.
INPUTS:    A text value the caller has already type-checked as ``str``;
           keyword token sets and the unknown-token policy.
OUTPUTS:   ``True``/``False``; raises ``error_type`` when ``on_unknown="raise"``
           and the token is in neither set.
CALLERS:   ``src.clean.score._coerce_bool`` (permissive),
           ``src.store.mapping._bool`` (strict, raises ``MappingError``).
TESTED BY: ``tests/test_common.py::test_text_to_bool_permissive_unknown_is_false``,
           ``::test_text_to_bool_strict_tokens``, ``::test_text_to_bool_strict_raises_on_unknown``.
"""

from __future__ import annotations

from typing import Literal

#: Stage 2 (clean) vocabulary — everything outside it reads as ``False``.
TRUE_TOKENS_PERMISSIVE = frozenset({"true", "1", "yes"})
#: Stage 3 (store) vocabulary — wider true-set plus an explicit false-set;
#: a token in neither set raises.
TRUE_TOKENS_STRICT = frozenset({"true", "t", "1", "yes"})
FALSE_TOKENS_STRICT = frozenset({"false", "f", "0", "no"})


def text_to_bool(
    text: str,
    *,
    true_tokens: frozenset[str],
    false_tokens: frozenset[str] = frozenset(),
    on_unknown: Literal["false", "raise"] = "false",
    error_type: type[Exception] = ValueError,
) -> bool:
    """Strip/lower ``text`` and match it against the caller's token sets."""
    token = text.strip().lower()
    if token in true_tokens:
        return True
    if token in false_tokens:
        return False
    if on_unknown == "raise":
        raise error_type(f"cannot interpret {text!r} as boolean")
    return False
