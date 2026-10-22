# sql/migrations/ — applied-change records

**What lives here.** `2026-10-16_tier1_is_active.sql` — the `BEGIN/COMMIT`
transcript record of adding `listings.is_active`, including the commented-out
manual stale-marking UPDATE that was run at the time. Migrations here are
**auditable history**, not a runner input: `src/store/db.py::apply_schema`
applies `sql/schema.sql` on every run, which already contains the same
`ADD COLUMN IF NOT EXISTS` guard.

**The one trap.** Do not "migrate" by editing an existing file — a migration is
a dated record of what *was* applied; schema changes go into `schema.sql` (and
mirror into `docs/data_contract.md`, which `test_contract_parity.py` diffs).
The re-apply runbook and its hazards H1–H3: `docs/apply_tier1_migration.md`.
