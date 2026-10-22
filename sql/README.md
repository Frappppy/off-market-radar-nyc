# sql/ — the Postgres/Neon schema

**What lives here.**

- `schema.sql` — the idempotent DDL for `listings`, `listing_snapshots`,
  `pipeline_runs` (+ indexes). Applied by stage 3 (`apply_schema`) on **every**
  run, so every statement must be safe to re-run against a populated database.
- `vercel_readonly_role.sql` — the `offmarket_reader` role with SELECT grants
  on the three views + `pipeline_runs` (placeholder password; real value only in
  Neon).
- `migrations/` — dated, auditable copies of applied changes
  (`2026-10-16_tier1_is_active.sql`).

**The one trap.** The `ALTER TABLE listings ADD COLUMN IF NOT EXISTS
is_active …` **upgrade guard must stay in `schema.sql`**, not only in
`migrations/`: `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so
without the guard a load would fail on any database created before the column
existed (invariant I6, hazard detail in `docs/apply_tier1_migration.md`).

**Detail.** The hand-maintained mirror of this DDL lives in
`docs/data_contract.md` §Stage 3 — parity is pinned by
`tests/test_contract_parity.py` + `tests/test_schema_sqlglot.py`. **Views are
not here** — they live in `dashboard/views.sql`.
