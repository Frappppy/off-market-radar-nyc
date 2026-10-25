"""WHAT:      Tier-1.1 stale-marking guards — the _MARK_STALE SQL shape (count
           gate, MIN(started_at) cut-off, success-only window, bound miss_runs),
           cold-start no-op below STALE_RUNS, rowcount pass-through with an
           explicit miss_runs, and reactivation by the listing upsert.
WHY:       Marking a live listing inactive hides it from the site; the SQL has
           failure modes (now() fallback, missing count gate) that would
           deactivate the whole table, so its text is asserted directly.
           Pure unit tests — FakeCursor/FakeConn stand in for psycopg.
INPUTS:    src.store.db statement constants + fakes (no live DB).
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
"""

from src.store import db


class FakeCursor:
    """Minimal psycopg cursor: records execute() calls, reports a fixed rowcount."""

    def __init__(self, rowcount: int = 0):
        self.rowcount = rowcount
        self.executed: list[tuple] = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, rowcount: int = 0):
        self.cursor_obj = FakeCursor(rowcount)

    def cursor(self):
        return self.cursor_obj


def test_mark_stale_sql_guards_parameterizes_and_requires_success():
    sql = db._MARK_STALE
    assert "UPDATE listings" in sql
    assert "SET is_active = false" in sql
    assert "l.is_active" in sql  # only ever flips active -> inactive
    assert "LIMIT %s" in sql  # miss_runs is a bound parameter, not string-built
    assert sql.count("%s") == 2  # the count gate and the LIMIT, both bound
    assert "status = 'success'" in sql  # only completed runs count as "missed"
    assert "started_at IS NOT NULL" in sql  # a NULL started_at cannot open the window


def test_mark_stale_is_a_noop_until_enough_successful_runs_exist():
    """Cold-start guard.

    With fewer than miss_runs successful runs the cut-off would collapse onto
    the most recent run, deactivating a listing after a SINGLE miss. The explicit
    count gate must short-circuit the whole statement instead.
    """
    sql = " ".join(db._MARK_STALE.split())
    assert "(SELECT count(*) FROM pipeline_runs WHERE status = 'success') >= %s" in sql


def test_mark_stale_cutoff_cannot_fall_back_to_now():
    """`last_seen_at < now()` is true for every listing, so a now() fallback
    would deactivate the entire table on an empty run history."""
    sql = db._MARK_STALE
    assert "COALESCE" not in sql
    assert "now()" not in sql
    assert "MIN(r.started_at)" in sql


def test_stale_runs_default_is_three():
    assert db.STALE_RUNS == 3


def test_mark_stale_listings_returns_rowcount_and_passes_miss_runs():
    conn = FakeConn(rowcount=7)
    assert db.mark_stale_listings(conn) == 7
    sql, params = conn.cursor_obj.executed[-1]
    assert sql is db._MARK_STALE
    # both bind slots carry the same threshold: the gate and the LIMIT
    assert params == (db.STALE_RUNS, db.STALE_RUNS)


def test_mark_stale_listings_honours_explicit_miss_runs():
    conn = FakeConn(rowcount=0)
    assert db.mark_stale_listings(conn, miss_runs=10) == 0
    sql, params = conn.cursor_obj.executed[-1]
    assert sql is db._MARK_STALE
    assert params == (10, 10)


def test_insert_listing_reactivates_a_returning_listing():
    """A listing seen again is set active again ("back on market"), and keeps
    refreshing last_seen_at."""
    do_update = " ".join(db._INSERT_LISTING.split("DO UPDATE", 1)[1].split())
    assert "is_active = true" in do_update
    assert "last_seen_at = now()" in do_update
