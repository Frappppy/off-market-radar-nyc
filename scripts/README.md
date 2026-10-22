# scripts/ — orchestration + one-off verification ladders

**What lives here.**

- `run_daily.py` — **the** daily orchestrator: builds the three stage commands,
  loads `config/*.local.env` additively (real env wins — CI secrets pass
  through), runs each stage via `sys.executable`, streams output into
  `jobs/<run_id>/run_log.md`, skips later stages after a failure. Carries the
  `DAILY_PAGES / DAILY_MAX_DETAILS / DAILY_DELAY` volume policy
  (30 / 120 / 5.0). Used by CI and the README Quickstart.
- `tier1_migration_check.py` + `.ps1` — one-off assertion ladder A–G against a
  real PostgreSQL (the `.ps1` boots an ephemeral local PG18 on Windows only).
- `live_db_check.ps1` — one-off 7-step e2e check of `src.store` +
  `dashboard/views.sql` (Windows-only).

**The one trap.** Only `run_daily.py` is in the daily path. The two `.ps1`
scripts **cannot run on POSIX at all**, and the `.py` ladder needs a live
database — none of the three is part of `pytest`. Their assertions are the only
real-database checks in the repo, so treat their transcripts under `jobs/` as
evidence, not dead weight.
