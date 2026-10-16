# Applying the Tier 1 migration (production Neon branch)

Status: **not yet applied.** Written 2026-10-16 when Tier 1
(`docs/roadmap.md`) was built, then corrected after the backend validation gate
found two blockers **in this runbook** (see "Hazards" below). Everything here is
a deliberate, reversible owner action; nothing applies it automatically.

Why this file exists: Tier 1 added one column and one view. The **site ships
safely before either exists**, but the price-history panel only becomes live
once the view and its grant are applied.

---

## What changed and why

| Artefact | Change | Read by |
|---|---|---|
| `listings.is_active` | new `boolean NOT NULL DEFAULT true` | `vw_latest_listings`, the loader |
| `vw_latest_listings` | now also exposes `is_active`, `last_seen_at` | Power BI, (future) Tier 2 |
| `vw_listing_history` | **new view** — the daily `listing_snapshots` series per listing | the `1.2` price-history panel |
| `pipeline_runs` | unchanged | ingestion health card (`1.4`) |

The stale-listing fix itself (`1.1`) does **not** depend on any of this. It is a
recency guard in `site/lib/db.ts` that keeps only the dataset's newest snapshot
cohort, so sold homes drop off the data surface. `is_active` is the *proper* fix
and the foundation for Tier 2's "back on market" signal.

Measured on production 2026-10-16:

| Query | Rows |
|---|---|
| previous behaviour (all snapshots) | **1,019** |
| new default (`window_days=0`) | **1,011** |
| difference = listings whose newest snapshot is not the newest cohort | **8** |

**Scope of that bug, stated accurately.** The 8 are all `Low` motivation, and the
default map filter is High+Medium with DOM ≥ 60 — so the *default map view* (157
rows) was unaffected; the inflation showed up in the unfiltered data surface and
the CSV export (1,019 vs 1,011). The fix is real, but it was never "8 sold homes
pinned on the map"; it is "stale rows in the export and totals".

---

## Hazards (read before applying)

**H1 — re-applying `dashboard/views.sql` wipes the site's permissions.**
Postgres stores a view's ACL *on the view object*. `views.sql` begins with
`DROP VIEW IF EXISTS ... CASCADE`, which destroys that object **and its ACL**;
the following `CREATE OR REPLACE VIEW` creates a new object that only its owner
may read. The site's `SELECT` on `vw_latest_listings` /
`vw_zip_price_drop_30d` exists *only* as that ACL — there is no
`ALTER DEFAULT PRIVILEGES` anywhere in this repo. So re-applying `views.sql`
**without re-granting silently drops the whole site to the frozen 82-row
fallback**, and the freshness strip will blame "Neon unreachable" while doing it.
This hazard pre-dates Tier 1; it is a property of that file.
→ Step 3 below therefore re-grants **all four objects**, not just the new one.

**H2 — `psql -f` exits 0 even when a statement failed.**
Without `-v ON_ERROR_STOP=1`, a failed migration looks like a successful one.
Use the flag; a rollback should be loud.

**H3 — the pipeline needs the column before its next run.**
The loader's upsert sets `is_active = true` on every load. `CREATE TABLE IF NOT
EXISTS` is a no-op on an existing database, so a database created before the
column existed cannot acquire it from `sql/schema.sql`'s table definition alone.
That is now handled: `sql/schema.sql` carries the `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS` as an **upgrade guard** applied by the store stage on every run, so
the next load repairs itself. This is why the guard lives in `schema.sql` *and*
in `sql/migrations/`. Do not remove it from either.

---

## Prove it locally first

Every claim in this file was originally reasoned about, not executed — there was no
local `psql` to run DDL against. `scripts/tier1_migration_check.ps1` closes that
gap and should be run **before** touching production:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tier1_migration_check.ps1
```

It boots an ephemeral local PostgreSQL 18 (`initdb -A trust`, 127.0.0.1 only — no
credentials, production never contacted), creates and drops its own `tier1_*`
databases, and asserts against the real code paths:

| # | Claim it proves |
|---|---|
| A | `views.sql` **before** the migration fails and names `is_active`; migration then views succeeds |
| B | every file re-applies cleanly and no view loses or reorders a column |
| C | a pre-Tier-1 database **rejects** the loader's real upsert (`42703`) until `sql/schema.sql`'s guard repairs it — then it succeeds (H3) |
| D | **H1, reproduced**: re-applying `views.sql` really does drop the reader's `SELECT` on both existing views, spares `pipeline_runs`, and the four-object re-grant in step 3 restores every read |
| E | the real `mark_stale_listings()` is a genuine no-op below `STALE_RUNS` successful runs, then deactivates exactly the listings that missed all N, is idempotent, and reactivates a returner |
| F | `vw_listing_history` exposes exactly the column set the shipped `LISTING_HISTORY_QUERY` selects, and that query (extracted from `site/lib/db.ts`) runs and returns history oldest-first |
| G | `snapshot_date = max(snapshot_date)` excludes the older cohort and survives a *missed run* without emptying the map |

Evidence lands in `jobs/<RunId>/evidence/assertions.txt`. Exit code 0 means every
assertion passed. If it fails, do not apply the migration.

---

## Apply order (production branch only)

```powershell
# 0. Fail loudly on any error, in every command below.
$psql = "psql -v ON_ERROR_STOP=1"

# 1. Add the column (idempotent; PG11+ metadata-only, no table rewrite)
& $psql "$env:DATABASE_URL" -f sql/migrations/2026-10-16_tier1_is_active.sql

# 2. Re-apply the views (idempotent: DROP ... CASCADE + CREATE OR REPLACE)
& $psql "$env:DATABASE_URL" -f dashboard/views.sql

# 3. RE-GRANT — required, not optional. Step 2 destroyed the old ACLs (H1).
#    Re-running only the GRANT is correct: the role already exists, so never
#    re-run the CREATE ROLE in sql/vercel_readonly_role.sql.
& $psql "$env:DATABASE_URL" -c "GRANT SELECT ON vw_latest_listings, vw_zip_price_drop_30d, vw_listing_history, pipeline_runs TO offmarket_reader;"
```

Neon console equivalent: run each file in the SQL editor in the same order, then
the GRANT from step 3. `$env:DATABASE_URL` is the **owner** connection string
(write access) — never the `offmarket_reader` one, and never committed.

## Verify

As the owner:

```sql
SELECT count(*) FILTER (WHERE is_active) AS active,
       count(*) FILTER (WHERE NOT is_active) AS inactive
FROM listings;

SELECT source, listing_id, snapshot_date, price, previous_price, price_drop_pct
FROM vw_listing_history ORDER BY snapshot_date DESC LIMIT 5;
```

As `offmarket_reader` — **all four must succeed**. After a `views.sql` re-apply
this is the step that catches H1, so do not skip it:

```sql
SELECT count(*) FROM vw_latest_listings;
SELECT count(*) FROM vw_zip_price_drop_30d;
SELECT count(*) FROM vw_listing_history;
SELECT count(*) FROM pipeline_runs;
```

...and these must still **fail** with `permission denied` (least privilege
unchanged — the base tables stay denied):

```sql
SELECT count(*) FROM listings;
SELECT count(*) FROM listing_snapshots;
```

Then the site:

```powershell
curl "https://off-market-radar-nyc.vercel.app/api/listing/<a real zpid>"
```

Before the grant: `200` with `{"history":[],"unavailable":true}`.
After: `200` with `"live":true` and an oldest→newest `history` array.

## Rollback

```sql
DROP VIEW IF EXISTS vw_listing_history CASCADE;
-- then re-apply the previous dashboard/views.sql (one without is_active)
-- ...and re-grant, or the site stays dark (H1).
ALTER TABLE listings DROP COLUMN IF EXISTS is_active;
```

Dropping the column is safe for the site: nothing in `site/` selects
`is_active`. The stale-listing fix keeps working either way — it filters on
`snapshot_date`, not on the new column. Note the loader *will* re-add the column
on the next run (H3).

---

## Deploy order (why the site is safe before the migration)

1. The recency guard reads only columns that already exist, so `/api/deals` is
   fixed the moment the site deploys — migration or not.
2. `/api/listing/[id]` degrades to `{history: [], unavailable: true}` when the
   view or grant is missing, so the panel states the history is unavailable
   instead of erroring the map.
3. `/api/health` reads only `pipeline_runs` and `vw_latest_listings`, both
   already granted.

So: re-grant whenever you re-apply the views, deploy the site whenever. The only
visible difference is the price-history panel.
