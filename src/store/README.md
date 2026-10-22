# src/store/ — Stage 3: Postgres loader (`python -m src.store`)

**What lives here.** `cli.py` runs **3 transactions** (apply schema + start run
→ upsert listings/snapshots → finish run + mark stale) with exit codes
`0/1/2`; `args.py` is its parser (split for the ≤200-line gate, re-imported);
`statements.py` holds **all SQL text** as constants; `db.py` is the connection +
upsert/stale/run bookkeeping (`STALE_RUNS = 3`); `mapping.py` + `scalars.py`
turn cleaned DataFrame rows into null-safe tuples (`LISTING_COLUMNS` = 13,
`SNAPSHOT_COLUMNS` = 12); `loader.py` reads the cleaned dir (Parquet preferred,
CSV fallback); `__init__.py` defines `StoreError`.

**The one trap.** Invariant **I12**: column *order* in `mapping.LISTING_COLUMNS`
/ `SNAPSHOT_COLUMNS` must equal the INSERT column order in `statements.py`
(built as f-strings from those very tuples — keep it that way) and the schema.
Pinned by `tests/test_contract_parity.py::test_mapping_*` — if you add a column,
that test is your checklist. The DB half of the score-enum CHECK is **not**
test-pinned (ARCHITECTURE.md §6).

**Detail.** Each file's T0 header. Tests: `tests/test_store_*.py`,
`tests/test_schema_sqlglot.py`. Needs `DATABASE_URL` (env or
`config/database.local.env`).
