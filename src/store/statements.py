"""WHAT:           All stage-3 SQL statements as constants — the two upserts
              (``_INSERT_LISTING``, ``_INSERT_SNAPSHOT``), the pipeline_runs
              bookkeeping (``_START_RUN``, ``_FINISH_RUN``, ``_RECORD_FAILURE``)
              and the stale listing marker (``_MARK_STALE`` + ``STALE_RUNS``).
WHY:            Column order in the INSERTs must equal
              ``mapping.LISTING_COLUMNS``/``SNAPSHOT_COLUMNS`` (REPO_MAP I12);
              keeping every statement in one file makes that contract
              reviewable in a single screen, apart from connection logic.
INPUTS:         ``mapping`` column tuples (f-string interpolation at import).
OUTPUTS:        SQL text constants + ``STALE_RUNS = 3``.
CALLERS:        ``src.store.db`` (executes them); SQL-text assertions in
              ``tests/test_schema_sqlglot.py``, ``tests/test_store_db.py``,
              ``tests/test_store_stale.py`` (via ``db.*``).
TESTED BY:      I4/I5/I6/I12 in ``tests/test_schema_sqlglot.py``,
              ``tests/test_store_stale.py``,
              ``test_record_failure_sql_never_overwrites_a_terminal_run``.
"""

from .mapping import LISTING_COLUMNS, SNAPSHOT_COLUMNS

# --- listings upsert --------------------------------------------------------

_INSERT_LISTING = f"""
INSERT INTO listings ({', '.join(LISTING_COLUMNS)})
VALUES ({', '.join(['%s'] * len(LISTING_COLUMNS))})
ON CONFLICT (source, listing_id) DO UPDATE SET
  address          = EXCLUDED.address,
  city             = EXCLUDED.city,
  state            = EXCLUDED.state,
  zip              = EXCLUDED.zip,
  latitude         = EXCLUDED.latitude,
  longitude        = EXCLUDED.longitude,
  property_type    = EXCLUDED.property_type,
  bedrooms         = EXCLUDED.bedrooms,
  bathrooms        = EXCLUDED.bathrooms,
  living_area_sqft = EXCLUDED.living_area_sqft,
  url              = EXCLUDED.url,
  is_active        = true,
  last_seen_at     = now()
"""

# --- snapshot upsert --------------------------------------------------------

_INSERT_SNAPSHOT = f"""
INSERT INTO listing_snapshots ({', '.join(SNAPSHOT_COLUMNS)})
VALUES ({', '.join(['%s'] * len(SNAPSHOT_COLUMNS))})
ON CONFLICT (source, listing_id, snapshot_date) DO UPDATE SET
  price             = EXCLUDED.price,
  previous_price    = EXCLUDED.previous_price,
  price_reduced     = EXCLUDED.price_reduced,
  days_on_market    = EXCLUDED.days_on_market,
  price_per_sqft    = EXCLUDED.price_per_sqft,
  price_drop_pct    = EXCLUDED.price_drop_pct,
  motivation_score  = EXCLUDED.motivation_score,
  motivation_reason = EXCLUDED.motivation_reason,
  scraped_at        = EXCLUDED.scraped_at
"""

# --- pipeline_runs bookkeeping ----------------------------------------------

_START_RUN = """
INSERT INTO pipeline_runs (run_id, started_at, status, source)
VALUES (%s, now(), 'running', %s)
ON CONFLICT (run_id) DO UPDATE SET
  started_at      = now(),
  finished_at     = NULL,
  status          = 'running',
  records_scraped = NULL,
  records_loaded  = NULL,
  notes           = NULL
"""

_FINISH_RUN = """
UPDATE pipeline_runs
SET finished_at = now(), status = %s, records_scraped = %s,
    records_loaded = %s, notes = %s
WHERE run_id = %s
"""

# --- failure recording for runs that never reached stage 3 -------------------

# WHY THIS EXISTS: when stage 1 (or 2) aborts, scripts/run_daily.py skips the
# store stage entirely, so NOTHING ever writes a pipeline_runs row and the run
# is invisible — /api/health then reports `runs_failed_30d: 0` for a month of
# failures. The orchestrator calls `python -m src.store --record-failure` to
# close the loop, and this statement is written so that call is always safe:
#
#   * no row yet (scrape/clean died before stage 3 started)  -> insert `failed`;
#   * row still `running` (stage 3 crashed mid-transaction)  -> close it;
#   * row already terminal (`success` / `failed`)            -> UNTOUCHED, so a
#     stage-3 failure note written by its own except-path is never overwritten
#     by the orchestrator's blunter one, and a successful run can never be
#     renamed. `CASE … ELSE pipeline_runs.status END` and the two COALESCEs are
#     what make the statement a no-op in exactly that case.
#
# started_at is COALESCE(%s, now()): the orchestrator knows the real UTC start
# from the run_id, but a hand-invoked call with an odd id still gets a timestamp.
# Verified by: test_record_failure_sql_never_overwrites_a_terminal_run
_RECORD_FAILURE = """
INSERT INTO pipeline_runs (run_id, started_at, finished_at, status, source, notes)
VALUES (%s, COALESCE(%s, now()), now(), 'failed', %s, %s)
ON CONFLICT (run_id) DO UPDATE SET
  started_at  = COALESCE(pipeline_runs.started_at, EXCLUDED.started_at),
  finished_at = COALESCE(pipeline_runs.finished_at, now()),
  status      = CASE WHEN pipeline_runs.status = 'running'
                     THEN 'failed' ELSE pipeline_runs.status END,
  notes       = COALESCE(pipeline_runs.notes, EXCLUDED.notes)
"""

# --- stale-listing marker ---------------------------------------------------

# A listing is deactivated after missing this many consecutive successful runs
# (it has not appeared in the feed for that many runs: sold / delisted / pulled).
# Verified by: test_stale_runs_default_is_three
STALE_RUNS = 3

# Cut-off = the started_at of the N-th most recent successful run. A listing
# whose last_seen_at predates that has missed N complete successful loads.
#
# The `count(*) >= N` gate is load-bearing, not decorative: it makes the whole
# statement a NO-OP until N successful runs exist. Without it, a freshly-seeded
# database (fewer than N runs) collapses the cut-off onto the most recent run —
# so a listing merely absent from today's feed, or one skipped because that run
# was partial, would be deactivated after a SINGLE miss instead of N. With too
# little history there is no honest way to tell "gone" from "not scraped this
# time", so the conservative choice is to do nothing.
#
# With the gate passed the subquery always yields N rows, so MIN() cannot be
# NULL; and if it ever were, `last_seen_at < NULL` is NULL and updates nothing,
# so the NULL path is safe regardless of evaluation order.
# The `l.is_active` guard keeps the UPDATE idempotent and cheap on re-runs.
# Verified by: test_mark_stale_is_a_noop_until_enough_successful_runs_exist
_MARK_STALE = """
UPDATE listings l
SET is_active = false
WHERE l.is_active
  AND (SELECT count(*) FROM pipeline_runs WHERE status = 'success') >= %s
  AND l.last_seen_at < (
        SELECT MIN(r.started_at)
          FROM (SELECT started_at
                  FROM pipeline_runs
                 WHERE status = 'success'
                   AND started_at IS NOT NULL
                 ORDER BY started_at DESC
                 LIMIT %s) AS r
      )
"""
