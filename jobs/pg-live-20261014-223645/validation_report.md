# Live database validation report — Project 1 (stage 3 `src.store` + stage 4 views)

| | |
|---|---|
| Run ID | `pg-live-20261014-223645` |
| Date | 2026-10-15 (times local +06) |
| Target | PostgreSQL 18.6, conda, ephemeral cluster `%LOCALAPPDATA%\Temp\opencode\pglive`, `127.0.0.1:55432`, `initdb -A trust` — **no passwords/credentials anywhere, none printed** |
| Overall | **10 PASS / 1 FAIL** — the single FAIL (A-2) is a real product bug found by this verification; root-caused in §3 |
| Evidence | `evidence/**` (manual ladder), `evidence-script-test/**` (durable script rerun) |
| Commits | none — `git status --porcelain` lists every path as `??` (untracked) |

## Assertion results

| # | Assertion | Result |
|---|-----------|--------|
| A-1 | PostgreSQL provisioned (conda install result) and accepting connections | **PASS** |
| A-2 | Stage 3 runs **unmodified** (`python -m src.store`) against the live DB | **FAIL** — exit 1, `OperationalError: the connection is closed` (product bug, §3) |
| A-3 | Initial load: exit 0, full row counts, pipeline row | **PASS** |
| A-4 | Idempotency: identical second load changes nothing | **PASS** |
| A-5 | Modified-price variant: `ON CONFLICT … DO UPDATE` rewrites exactly one row | **PASS** |
| A-6 | Exactly ONE `pipeline_runs` row, `status='success'`, 10/10 records | **PASS** |
| A-7 | Stage 4 views live: `vw_latest_listings`, `vw_zip_price_drop_30d`, definitions | **PASS** |
| A-8 | Failure path: no `DATABASE_URL` → exit 2, DB untouched | **PASS** |
| A-9 | Server stopped cleanly afterwards | **PASS** |
| A-10 | Durable script `scripts/live_db_check.ps1` reruns every assertion | **PASS** (30/30, exit 0) |
| A-11 | Writes confined to allowed paths; nothing committed; `.venv` untouched | **PASS** |

A-3 … A-8 were executed twice: once manually (verbatim below) and once again
end-to-end by the durable script (A-10). Because of A-2 they were executed through
the documented in-process shim of §3 — all `src/store/` code itself runs unmodified.

---

## 1. Environment (A-1: PASS)

```
postgres (PostgreSQL) 18.6
psql (PostgreSQL) 18.6
Python 3.14.4
psycopg 3.3.6
psycopg-binary 3.3.6
pandas 3.0.6
pyarrow 26.0.0
python-dotenv 1.2.4
```

(Installed versions via `importlib.metadata`; identical to the `requirements.txt`
pins. No `pip install` ran during this task.)

Conda install result — completed during setup on 2026-10-14; verified verbatim now:

```
prefix CreationTime: 10/14/2026 22:37:44
postgres.exe CreationTime: 10/14/2026 22:37:36
C:\ProgramData\anaconda3
C:\Users\omisg\.conda\envs\zaynenv
C:\Users\omisg\AppData\Local\Temp\opencode\pglive      <- environments.txt entry for the live prefix
```

Readiness at the start of the ladder:

```
pg_isready(before): 127.0.0.1:55432 - accepting connections
127.0.0.1:55432 - accepting connections
```

Schema/views present before the ladder:

```
listings|listing_snapshots|pipeline_runs|vw_latest_listings|vw_zip_price_drop_30d
```

(The cluster started with leftover rows from yesterday's failed attempts:
`listings 4, snapshots 0, runs 3` → first action was a TRUNCATE.)

---

## 2. Verbatim ladder

### A-2 — unshimmed stage 3 (FAIL: the product bug, reproduced)

First a clean slate:

```
TRUNCATE TABLE
 listings | snapshots | runs
----------+-----------+------
        0 |         0 |    0
(1 row)
```
`evidence/00_truncate.txt`, `01_counts_after_truncate.txt`

```
COMMAND: .venv\Scripts\python.exe -m src.store --in jobs\pg-live-20261014-223645\cleaned --run-id pg-live-20261014-223645
EXIT CODE: 1
--- OUTPUT (stdout+stderr) ---
python.exe : src.store: ERROR: OperationalError: the connection is closed
At line:7 char:8
+ $out = & $py -m src.store --in "jobs\pg-live-20261014-223645\cleaned" ...
+        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (src.store: ERRO...ction is closed:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

src.store: WARNING: could not mark run failed: the connection is closed
```
`evidence/10_store_unshimmed.txt` (the `CategoryInfo` block is PowerShell 5.1's
stderr-capture wrapper, not program output)

DB state after the failure — transaction 1 committed (schema + `running` marker),
transaction 2 never did, and the error path could not mark `failed`:

```
         run_id          | status  | records_scraped | records_loaded | unfinished
-------------------------+---------+-----------------+----------------+------------
 pg-live-20261014-223645 | running |                 |                | t
(1 row)

 listings | snapshots | runs
----------+-----------+------
        0 |         0 |    1
(1 row)
```
`evidence/11_runs_after_unshimmed.txt`, `12_counts_after_unshimmed.txt`

Same failure already recorded twice on 2026-10-14 (`store/process_log.md`):

```
- ERROR: OperationalError: the connection is closed
- status: `failed`
```

### A-3 — initial load via documented shim (PASS)

Clean slate again (after the failed probe):

```
TRUNCATE TABLE
 listings | snapshots | runs
----------+-----------+------
        0 |         0 |    0
(1 row)
```
`evidence/20_truncate2.txt`

```
COMMAND: .venv\Scripts\python.exe jobs\pg-live-20261014-223645\run_store_shim.py --in jobs\pg-live-20261014-223645\cleaned --run-id pg-live-20261014-223645
EXIT CODE: 0
--- stdout ---

--- stderr ---
python.exe : [shim] psycopg.Connection.__exit__ patched: commit/rollback WITHOUT close (psycopg 3.3.6 upstream closes
non-pooled connections; see validation_report.md)
```
`evidence/21_store_shim_run1.txt` (PowerShell wrapper lines elided)

```
 listings | snapshots | runs
----------+-----------+------
       10 |        10 |    1
(1 row)

         run_id          | status  | records_scraped | records_loaded | source
-------------------------+---------+-----------------+----------------+--------
 pg-live-20261014-223645 | success |              10 |             10 | zillow
(1 row)
```
`evidence/22_counts_after_run1.txt`, `23_runs_after_run1.txt`

### A-4 — identical re-load, idempotency (PASS)

```
COMMAND: (identical re-run, 2nd load)
EXIT CODE: 0
```
`evidence/24_store_shim_run2.txt`

```
 listings | snapshots | runs
----------+-----------+------
       10 |        10 |    1
(1 row)

         run_id          | status  | records_scraped | records_loaded
-------------------------+---------+-----------------+----------------
 pg-live-20261014-223645 | success |              10 |             10
(1 row)
```
`evidence/25_state_after_run2.txt` — counts unchanged, still exactly one row
(`ON CONFLICT` upserts, no duplicates; `start_pipeline_run` resets the same row).

Baseline prices (`evidence/26_prices_after_run2.txt`):

```
zillow|Z-1001|price=464500|snap=2026-10-14
zillow|Z-1002|price=600000|snap=2026-10-14
zillow|Z-1003|price=376000|snap=2026-10-14
zillow|Z-1004|price=345000|snap=2026-10-14
zillow|Z-1005|price=289000|snap=2026-10-14
zillow|Z-1006|price=250000|snap=2026-10-14
zillow|Z-1007|price=750000|snap=2026-10-14
zillow|Z-1008|price=304000|snap=2026-10-14
zillow|Z-1009|price=94500|snap=2026-10-14
zillow|Z-1010|price=119000|snap=2026-10-14
```

### A-5 — modified-price variant, real `DO UPDATE` (PASS)

Modification input (`evidence/30_make_modified_price.txt`):

```json
{
  "source_file": "jobs\\pg-live-20261014-223645\\cleaned\\listings_2026-10-14.parquet",
  "output_file": "jobs\\pg-live-20261014-223645\\cleaned-modified\\listings_2026-10-14.parquet",
  "row_index": 0,
  "source": "zillow",
  "listing_id": "Z-1001",
  "snapshot_date": "2026-10-14",
  "price_current_before": 464500,
  "price_current_after": 439500,
  "delta": 25000
}
```

```
COMMAND: run_store_shim.py --in jobs\pg-live-20261014-223645\cleaned-modified --run-id pg-live-20261014-223645 (one price_current changed)
EXIT CODE: 0
```
`evidence/31_store_shim_run3_modified.txt`

```
 listings | snapshots | runs
----------+-----------+------
       10 |        10 |    1
(1 row)

         run_id          | status  | records_scraped | records_loaded
-------------------------+---------+-----------------+----------------
 pg-live-20261014-223645 | success |              10 |             10
(1 row)
```
`evidence/32_state_after_run3.txt` — counts identical (10/10), single row.

Exact diff of the price dumps (`evidence/34_price_diff.txt`):

```
Compare-Object: evidence/26_prices_after_run2.txt (run 2) vs evidence/33_prices_after_run3.txt (run 3)
=> zillow|Z-1001|price=439500|snap=2026-10-14
<= zillow|Z-1001|price=464500|snap=2026-10-14
DIFF ENTRY COUNT: 2  (2 = exactly one line changed)
```

Same key (`source, listing_id, snapshot_date`), same counts, exactly one row's
`price` rewritten 464500 → 439500 — `ON CONFLICT … DO UPDATE` proven live.

### A-6 — single `pipeline_runs` row (PASS)

After THREE loads sharing the run-id (initial, identical, modified-price):

```
         run_id          | status  | records_scraped | records_loaded
-------------------------+---------+-----------------+----------------
 pg-live-20261014-223645 | success |              10 |             10
(1 row)
```
`evidence/32_state_after_run3.txt`; independently re-asserted by the script
(`PASS run 3: still exactly one pipeline_runs row`, `PASS pipeline_runs records_loaded`).

### A-7 — stage 4 views live (PASS)

```
 count
-------
    10
(1 row)

 source | listing_id |  zip  | price  | days_on_market | price_drop_pct | motivation_score | snapshot_date
--------+------------+-------+--------+----------------+----------------+------------------+---------------
 zillow | Z-1001     | 11201 | 439500 |            112 |           7.10 | High             | 2026-10-14
 zillow | Z-1002     | 10023 | 600000 |            120 |                | Medium           | 2026-10-14
 zillow | Z-1003     | 11101 | 376000 |             15 |           6.00 | Medium           | 2026-10-14
 zillow | Z-1004     | 11215 | 345000 |             20 |           1.43 | Low              | 2026-10-14
 zillow | Z-1005     |       | 289000 |              5 |                | Low              | 2026-10-14
(5 rows)
```
`evidence/40_vw_latest_count.txt` — `vw_latest_listings` shows the **updated**
price 439500 for Z-1001 (view reads the latest snapshot).

```
  zip  | snapshot_date | avg_price_drop_pct | listing_count
-------+---------------+--------------------+---------------
 07068 | 2026-10-14    |                    |             1
 10002 | 2026-10-14    |               5.00 |             1
 10023 | 2026-10-14    |                    |             1
 11101 | 2026-10-14    |               6.00 |             1
 11201 | 2026-10-14    |               7.10 |             1
 11215 | 2026-10-14    |               1.43 |             1
 13201 | 2026-10-14    |               0.83 |             1
 14201 | 2026-10-14    |               5.50 |             1
(8 rows)
```
`evidence/41_vw_zip_drop.txt` — NULL `avg_price_drop_pct` where the zip's listings
have no `price_drop_pct` (AVG ignores NULLs, as documented in `dashboard/views.sql`).

Definitions from `pg_views` (`evidence/42_view_definitions.txt`, abridged to the
`FROM`/`WHERE` core):

```
vw_latest_listings =>  SELECT l.source, l.listing_id, ... , s.price, ..., s.snapshot_date, l.url
   FROM (listings l
     JOIN ( SELECT DISTINCT ON (listing_snapshots.source, listing_snapshots.listing_id) ...
            FROM listing_snapshots
          ORDER BY ... snapshot_date DESC) s ON (((s.source = l.source) AND (s.listing_id = l.listing_id))));

vw_zip_price_drop_30d =>  SELECT l.zip, s.snapshot_date, avg(s.price_drop_pct) AS avg_price_drop_pct, count(*) AS listing_count
   FROM (listing_snapshots s
     JOIN listings l ON (((l.source = s.source) AND (l.listing_id = s.listing_id))))
  WHERE ((s.snapshot_date >= (CURRENT_DATE - 30)) AND (l.zip IS NOT NULL))
  GROUP BY l.zip, s.snapshot_date;
```

### A-8 — failure path, `DATABASE_URL` missing (PASS)

```
DATABASE_URL: <not set>
COMMAND: .venv\Scripts\python.exe -m src.store --in jobs\pg-live-20261014-223645\cleaned --run-id pg-live-20261014-223645 (DATABASE_URL not set)
EXIT CODE: 2
--- stdout ---

--- stderr ---
python.exe : src.store: ERROR: DATABASE_URL is not set.
At line:7 char:1
+ & $py -m src.store --in "jobs\pg-live-20261014-223645\cleaned" --run- ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (src.store: ERRO...URL is not set.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

  Provide it via the environment or config/database.local.env (gitignored).
  Format (see config/database.env.example):
    DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require

--- DB untouched by config failure: ---
runs=1 status=success
```
`evidence/50_store_no_database_url.txt` (note: `config/database.local.env` is absent,
so the env var alone decides; the printed format string is the repo's own help text,
contains no real credentials)

### A-9 — server stopped (PASS)

```
waiting for server to shut down.... done
server stopped
pg_isready(after): 127.0.0.1:55432 - no response (exit=2)
```
`evidence/60_pg_stop.txt` — re-verified again at the end of the script rerun
(`PASS server stopped`, 12:08:39).

### A-10 — durable script rerun (PASS: 30/30, exit 0)

Command:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live_db_check.ps1 -RunId pg-live-20261014-223645 -EvidenceDir jobs\pg-live-20261014-223645\evidence-script-test
```

Result (`evidence-script-test/assertions.txt`, verbatim; timestamps 2026-10-15 12:08:26→12:08:39):

```
live_db_check  run_id=pg-live-20261014-223645  2026-10-15 12:08:26
PASS  PostgreSQL 18 accepting connections on 127.0.0.1:55432
PASS  backend process spawns (psql SELECT 1 round-trip)
PASS  cleaned listings_*.parquet present
PASS  fixture records_out known
INFO  unshimmed src.store exit=1 (expected 1; bug documented in validation_report.md)
PASS  sql/schema.sql applied
PASS  clean slate after TRUNCATE
PASS  shim written: jobs/<run>/run_store_shim.py
PASS  builder written: jobs/<run>/make_modified_price.py
PASS  run 1 (initial load) exit code
PASS  run 1: listings count
PASS  run 1: listing_snapshots count
PASS  run 1: exactly one pipeline_runs row
PASS  run 2 (identical re-load) exit code
PASS  run 2: counts unchanged
PASS  run 2: still exactly one pipeline_runs row
PASS  pipeline_runs status=success
PASS  pipeline_runs records_loaded
PASS  make_modified_price.py exit code
PASS  run 3 (modified price) exit code
PASS  run 3: counts unchanged (no delete+reinsert)
PASS  exactly ONE snapshot price line changed
PASS  DO UPDATE wrote price_current_after
PASS  run 3: still exactly one pipeline_runs row
PASS  dashboard/views.sql applied
PASS  SELECT count(*) FROM vw_latest_listings
PASS  both view definitions present in pg_views
PASS  SELECT ... FROM vw_zip_price_drop_30d returns rows
PASS  missing DATABASE_URL -> exit code 2
PASS  DB untouched by config failure (still 1 success row)
PASS  server stopped (pg_isready reports no response)

RESULT: 30 passed, 0 failed
SCRIPT EXIT CODE: 0
```

### A-11 — write scope, git, `.venv` (PASS)

Protected files (mtimes predate this session's writes — untouched):

```
src\store\cli.py          10/14/2026 10:01:34 PM
src\store\db.py           10/14/2026  9:52:36 PM
src\store\loader.py       10/14/2026  9:52:07 PM
src\store\mapping.py      10/14/2026  9:51:42 PM
src\store\reporting.py    10/14/2026 10:03:26 PM
src\store\__init__.py     10/14/2026  9:51:24 PM
src\store\__main__.py     10/14/2026  9:51:24 PM
sql\schema.sql            10/14/2026  9:51:11 PM
dashboard\views.sql       10/14/2026  9:52:55 PM
```

```
?? .github/   ?? .gitignore   ?? README.md   ?? config/   ?? dashboard/
?? docs/      ?? jobs/         ?? requirements.txt   ?? scripts/
?? sql/       ?? src/          ?? tests/
```
— every path untracked, zero commits made.

`.venv` re-verified after all runs: psycopg 3.3.6, psycopg-binary 3.3.6, pandas 3.0.6,
pyarrow 26.0.0, python-dotenv 1.2.4 — unchanged; no installer ran.

Note: `requirements.txt` shows mtime 2026-10-15 11:03 (inside this window) although
this task never wrote it and ran no installer; content re-verified afterwards —
all pins intact and equal to the installed versions (shown above).

Files written by this task (and nothing else): `scripts/live_db_check.ps1`;
`jobs/pg-live-20261014-223645/{validation_report.md, process_log.md, evidence/**,
evidence-script-test/**, run_store_shim.py, make_modified_price.py,
cleaned-modified/**, debug_*.py, psql_pause.sql}`; `store/process_log.md` was
appended by `src.store` itself during its runs.

---

## 3. Why A-2 fails — root cause (found by this verification)

`src/store/cli.py` opens ONE connection and wraps FOUR transactions in
`with conn:` (lines 161, 166, 172, 192). In the pinned psycopg 3.3.6,
`Connection.__exit__` (`.venv/Lib/site-packages/psycopg/connection.py:159–180`,
byte-identical to upstream tag 3.3.6) commits/rolls back and then **closes** a
non-pooled connection:

```python
        else:
            self.commit()

        # Close the connection only if it doesn't belong to a pool.
        if not getattr(self, "_pool", None):
            self.close()
```

So transaction 1's exit closes the connection; transaction 2 raises
`OperationalError: the connection is closed` → exit 1; the error path's own
`with conn:` (meant to mark the run `failed`) is closed too → the row stays
`running`. This matches yesterday's two failed attempts exactly.

Evidence chain (all files in this directory):

- `evidence/10_store_unshimmed.txt` — the failure, exit 1, both messages above.
- `debug_watch2.py` — a socket watcher on the connection's handle: the handle is
  closed at the exact `with conn:` exit (+0.414 s, WinError 10038 WSAENOTSOCK,
  "not a socket"), txn2 at +3.4 s raises "the connection is closed",
  `conn.closed=True`, and the server log records the client disconnection in the
  same millisecond as the COMMIT.
- Environment exonerated: `debug_rawproto.py` (hand-rolled protocol),
  `debug_ctypes_libpq.py` (ctypes + conda libpq, simple and extended protocol),
  `debug_watch_psycopg.py` (explicit `conn.commit()` instead of `with conn:`) and
  psql all survive 3 s idle; only `with conn:` blocks die.
- `db.py` itself only uses `with conn.cursor() as cur:` (safe) — the bug is
  exclusively cli.py's transaction pattern.

**Recommended fix (NOT applied — `src/store/` is outside this task's write scope):**
use `with conn.transaction():` for each of the four transactions (or reconnect per
transaction, or a pool). Until then, plain live `python -m src.store` always fails
as in A-2.

**Compensation used for A-3 … A-7 and A-10:** `run_store_shim.py` — a documented
runtime shim that replaces `psycopg.Connection.__exit__` with the identical
commit/rollback logic minus the close. The patch exists only in the process; no
repository file is modified; every `src/store/` module runs unmodified against the
real PostgreSQL. Each shimmed run prints on stderr:

```
[shim] psycopg.Connection.__exit__ patched: commit/rollback WITHOUT close
```

---

## 4. Gaps NOT closed

1. **A-2 stays FAIL**: `src/store/cli.py` is incompatible with pinned psycopg 3.3.6
   close-on-exit semantics, and this task may not modify `src/store/`. All
   load/idempotency/upsert/pipeline/views assertions therefore ran through the §3
   shim, not through plain `python -m src.store`. Any plain live run today fails
   with exit 1 and leaves `pipeline_runs` at `running`.
2. Consequence of the same bug: cli cannot write `status='failed'` on error when
   the connection is already closed (observed row stuck at `running`).
3. Data scope: the committed 10-row fixture (stage 1 was not re-scraped live —
   out of scope for stages 3+4).
4. The ephemeral cluster carries diagnosis-era GUCs (`log_statement='all'`,
   `autovacuum=off`, keepalive tweaks). Pristine cluster: delete
   `%LOCALAPPDATA%\Temp\opencode\pglive\pgdata` and re-run the script (it re-inits
   with defaults + `-o "-h 127.0.0.1 -p 55432"` only).
5. Historical anomaly not re-verified: yesterday's ~22:47 "poll survived 12 s"
   used an earlier variant of `debug_poll.py` (since rewritten); today the same
   pattern dies at the first 0.5 s gap. Does not affect the conclusion — the root
   cause was proven directly.
6. Cosmetic: `evidence/10, 21, 24, 31, 50` contain PowerShell 5.1
   `NativeCommandError` wrapper lines around stderr (capture artifact; the
   application's own messages are intact). The durable script captures streams via
   `Start-Process` redirection — no wrapper noise (`evidence-script-test/*`).
7. During the first script test, `pg_ctl` lingered in exit after a successful
   start (antivirus), and the harness's 600 s kill left the postmaster in a
   backend fork-crash loop (`0xC0000142` / shm `487`). The script now bounds every
   `pg_ctl`/`initdb` call, polls readiness, recovers a live-but-unresponsive
   postmaster with stop→start, and asserts a `SELECT 1` backend round-trip
   (see `process_log.md`). Recovery succeeded: ready in 4 s, `SELECT 1` → `1`.

---

## 5. How to rerun

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live_db_check.ps1
```

- Exit 0 = every assertion passed (or a graceful `SKIP:` when conda/PostgreSQL is
  absent — it self-heals `Library\share`/`Library\lib` from the conda pkgs cache
  and re-inits the cluster if needed); exit 1 = at least one assertion failed.
- Results land in `jobs/<run-id>/evidence/assertions.txt` (machine-checkable list)
  plus per-step transcripts; options: `-RunId`, `-EvidenceDir`, `-KeepServer`,
  `-SkipUnshimmedProbe`.
