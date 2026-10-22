"""WHAT:      Null-safe scalar coercions for the Zillow parsers — ``_first()``,
           ``as_int()``, ``as_float()``, ``ms_to_date()``.
WHY:        Every embedded-JSON field arrives in whatever type Zillow shipped
           (number, numeric string, ``None``, NaN); these four helpers are the
           single place that decides "absent" vs "value", so extract/derive/
           record never re-implement it with subtly different NaN handling.
INPUTS:     Any scalar value; epoch milliseconds (number) for ``ms_to_date``.
OUTPUTS:    First present value; rounded ``int`` / ``float`` or ``None``;
           ``YYYY-MM-DD`` (UTC) or ``None``.
CALLERS:    ``src.scrape.parsing.extract``, ``.derive``, ``.text``,
           ``.record`` (and ``parsing/__init__`` re-exports). Split verbatim
           from the pre-phase-2 ``src/scrape/parsers.py``.
TESTED BY:  ``tests/test_scrape.py::test_ms_to_date_utc`` (``ms_to_date``);
            ``_first``/``as_int``/``as_float`` via the record-builder tests
            (``test_search_only_record_obeys_contract_shape`` and friends).
"""

from datetime import datetime, timezone


# --- tiny null-safe coercions ----------------------------------------------

def _first(*values):
    """First value that is present (None/missing only — 0 and False count).
    Verified by: NOTHING (gap — the 0/False-counting rule is untested)."""
    for value in values:
        if value is None:
            continue
        if isinstance(value, float) and value != value:  # NaN
            continue
        return value
    return None


def as_int(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return int(round(number))


def as_float(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if number != number else number


def ms_to_date(value):
    """Epoch milliseconds -> ``YYYY-MM-DD`` (UTC)."""
    number = as_float(value)
    if number is None:
        return None
    try:
        return datetime.fromtimestamp(number / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d")
    except (OverflowError, OSError, ValueError):
        return None
