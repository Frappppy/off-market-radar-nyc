# process_log — live DB verification run `pg-live-20261014-223645`

Chronology of closing the stage-3/stage-4 verification gap against a real PostgreSQL.
All timestamps local (+06) unless marked `Z` (UTC). Evidence files live in
`evidence/` (manual ladder) and `evidence-script-test/` (durable script rerun).

## 2026-10-14 — session setup (before verbatim capture)

- run-id minted: `pg-live-20261014-223645` (22:36:45 local).
- Stage 2 clean executed: `cleaned/manifest.json` → `records_in=10`, `records_out=10`,
  `started_at=2026-10-14T16:43:32Z`, status success.
- PostgreSQL 18.6 provisioned via conda into `%LOCALAPPDATA%\Temp\opencode\pglive`
  (prefix `CreationTime 10/14/2026 22:37:44`, `postgres.exe` 22:37:36; registered in
  `C:\Users\omisg\.conda\environments.txt`). Cluster `pgdata`, listening
  `127.0.0.1:55432`, `initdb -A trust` (no passwords anywhere).
- `sql/schema.sql` + `dashboard/views.sql` applied (tables listings, listing_snapshots,
  pipeline_runs, 2 indexes, views vw_latest_listings, vw_zip_price_drop_30d).
- Two `python -m src.store` attempts FAILED (store/process_log.md):
  `started_at 2026-10-14T16:43:51+00:00` and `2026-10-14T16:50:08+00:00`,
  both `- ERROR: OperationalError: the connection is closed` → status `failed`.
  Stage 3 had therefore never completed against a real database.

## 2026-10-15 morning — root-cause diagnosis (server read-only for the environment tests)

- 08:36–10:48 — debug battery (`debug_*.py`): dual-stack, raw sockets, keepalive,
  poll, stability, psql-pause. Raw sockets, ctypes libpq (simple + extended
  protocol) and psql all survive 3 s idle → network/AV/filter hypothesis dead.
- 11:03:36 — `debug_rawproto.py` (hand-rolled protocol) survives 3 s idle.
- 11:08:04 — `debug_ctypes_libpq.py` survives 3 s idle in both phases.
- 11:10:53 — `debug_watch_psycopg.py` with explicit `conn.commit()` stays alive 3 s.
- 11:11:48 — `debug_watch2.py` with the exact `with conn:` pattern:
  socket handle closed locally at with-exit (+0.414 s, WSAENOTSOCK/WinError 10038),
  txn2 at +3.4 s raises "the connection is closed", server log shows the client
  disconnection in the same millisecond as the COMMIT → **ROOT CAUSE ISOLATED**.
- Source confirmation: `.venv/Lib/site-packages/psycopg/connection.py:159–180`
  (`if not getattr(self, "_pool", None): self.close()`) is byte-identical to upstream
  psycopg 3.3.6; `src/store/cli.py` runs one `connect()` and FOUR `with conn:`
  transactions → transaction 2 (and the "mark failed" error path) always dies.

## 2026-10-15 late morning — assertion ladder (manual, verbatim)

- 11:26:34 — `TRUNCATE TABLE listings, listing_snapshots, pipeline_runs;` → 0/0/0
  (`evidence/00_truncate.txt`, `01_counts_after_truncate.txt`).
- 11:26:52 — unshimmed `python -m src.store …` → **exit 1**, "the connection is closed"
  (`evidence/10_store_unshimmed.txt`); DB after: pipeline_runs row `running`,
  unfinished (`11_runs_after_unshimmed.txt`), counts 0/0/1 (`12_counts_after_unshimmed.txt`).
- 11:27:58 — TRUNCATE again → 0/0/0 (`20_truncate2.txt`).
- 11:27:59 — shimmed run 1 (initial load) → **exit 0** (`21_store_shim_run1.txt`);
  counts 10/10/1 (`22_counts_after_run1.txt`); pipeline_runs
  `success, 10, 10, zillow` (`23_runs_after_run1.txt`).
- 11:28:33 — shimmed run 2 (identical input, same run-id) → **exit 0**
  (`24_store_shim_run2.txt`); counts unchanged 10/10/1 + success row
  (`25_state_after_run2.txt`); 10-row price baseline (`26_prices_after_run2.txt`).
- 11:28:53 — `make_modified_price.py` → `cleaned-modified/` with
  Z-1001 `price_current` 464500 → 439500, same `snapshot_date` (`30_make_modified_price.txt`).
- 11:28:54 — shimmed run 3 → **exit 0** (`31_store_shim_run3_modified.txt`);
  counts still 10/10/1 (`32_state_after_run3.txt`); price dump
  `33_prices_after_run3.txt`; diff vs run 2 = exactly one line
  (`34_price_diff.txt`).
- 11:29:20 — stage 4 views: `vw_latest_listings` count 10 + 5 sample rows
  (`40_vw_latest_count.txt`), `vw_zip_price_drop_30d` 8 rows (`41_vw_zip_drop.txt`),
  both view definitions from `pg_views` (`42_view_definitions.txt`).
- 11:29:47 — `DATABASE_URL` not set → **exit 2** (`50_store_no_database_url.txt`);
  DB untouched (`runs=1 status=success`).
- 11:30:57 — `pg_ctl stop` → "server stopped"; pg_isready "no response" (exit=2)
  (`60_pg_stop.txt`).

## 2026-10-15 midday — durable-script test, incident, hardening, rerun

- 11:43:40 — first test of `scripts/live_db_check.ps1`: server started
  ("waiting for server to start.... done"), but `pg_ctl` lingered in exit
  (antivirus pathology) → the `pg_ctl … | Out-File` pipeline never returned →
  harness 600 s timeout killed the tree at ~11:53.
- 11:54:20 onward — postmaster left alive but in a backend fork-crash loop:
  `client backend (PID …) was terminated by exception 0xC0000142`, then
  `could not reserve shared memory region … error code 487`,
  "all server processes terminated; reinitializing" repeating → pg_isready
  "no response" for 13+ minutes.
- 11:54–11:56 — recovery: bounded `pg_ctl stop -m immediate` (done in ~20 s),
  bounded start (pg_ctl killed after its 30 s exit-lag; postmaster independent),
  readiness poll → `ready=True after 4s`; `psql SELECT 1` → `1` (backends spawn again).
- Hardened `scripts/live_db_check.ps1`:
  - `Invoke-BoundedExe` wraps every `pg_ctl`/`initdb` call
    (Start-Process + `WaitForExit(timeout)` + kill — the postmaster is daemonized,
    so killing a lingering tool process is safe);
  - readiness via `pg_isready` polling with a 60 s deadline;
  - stop-before-start recovery for a live-but-unresponsive postmaster;
  - new assertion: backend fork check (`psql SELECT 1` round-trip).
- 12:08:26–12:08:39 — end-to-end rerun:
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live_db_check.ps1
  -RunId pg-live-20261014-223645 -EvidenceDir jobs\pg-live-20261014-223645\evidence-script-test`
  → **RESULT: 30 passed, 0 failed; SCRIPT EXIT CODE: 0**
  (`evidence-script-test/00_script_console.txt`, `assertions.txt`).
- 12:08:39 — script stopped the server (pg_isready no response).

## Final state

- Server: **STOPPED** (verified `pg_isready` → "no response", exit=2).
- Database (when last checked by the script's passing assertions):
  listings 10, listing_snapshots 10, pipeline_runs 1 (`success`, 10/10),
  Z-1001 price 439500 (DO UPDATE result).
- Deliverables: `scripts/live_db_check.ps1`, this file, `validation_report.md`,
  `evidence/**`, `evidence-script-test/**`.
- No commits; `git status --porcelain` shows every path untracked (`??`).
