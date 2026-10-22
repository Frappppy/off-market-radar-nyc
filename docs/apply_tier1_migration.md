# Applying the Tier 1 migration (production Neon branch)

Status: **applied to production 2026-10-16 (~13:55Z).** Written 2026-10-16 when
Tier 1 (`docs/roadmap.md`) was built, then corrected after the backend validation
gate found two blockers **in this runbook** (see "Hazards" below). Every step is a
deliberate, reversible owner action; nothing here applies automatically.

Why this file exists: Tier 1 added one column and one view. The **site shipped
safely before either existed**; the price-history panel went live once the view
and its grant were applied. The apply order and its measured results are below.

---

## What changed and why

| Artefact | Change | Read by |
|---|---|---|
| `listings.is_active` | new `boolean NOT NULL DEFAULT true` | `vw_latest_listings`, the loader |
| `vw_latest_listings` | now also exposes `is_active`, `last_seen_at` | Power BI, (future) Tier 2 |
| `vw_listing_history` | **new view** — the daily `listing_snapshots` series per listing | the `1.2` price-history panel |
| `pipeline_runs` | unchanged | ingestion health card (`1.4`) |

The stale-listing fix itself (`1.1`) does **not** depend on any of this. It is a
recency guard in `site/lib/db/deals-query.ts` (formerly `site/lib/db.ts`) that keeps only the dataset's newest snapshot
cohort, so sold homes drop off the data surface. `is_active` is the *proper* fix
and the foundation for Tier 2's "back on market" signal.

Measured on production 2026-10-16:

| Query | Rows |
|---|---|
| previous behaviour (all snapshots) | **1,019** |
| recency guard applied (`window_days=0`) | **1,011** |
| difference = listings whose newest snapshot is not the newest cohort | **8** |

*Superseded since:* `window_days = 0` was the guard's shape on the day this migration
was applied, and it is what these numbers measure. The *shipped* default is now
`window_days = 1`, because `window_days = 0` made every row's date identical and so
made the per-listing "last seen" label meaningless. The unfiltered surface and CSV
therefore return **1,019** again — the same 1,011-row cohort plus those 8 rows, which
are now flagged as carried over rather than silently presented as current. Both
cohorts stay reachable by passing `window_days` explicitly. See `docs/roadmap.md`.

**Scope of that bug, stated accurately.** The 8 are all `Low` motivation, and the
default map filter is High+Medium with DOM ≥ 60 — so the *default map view* (133
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
`ALTER DEFAULT PRIVILEGES` in this repo, and none in the database that covers
objects created by `neondb_owner` (two entries exist, `cloud_admin` →
`neon_superuser`, and they do not apply). So re-applying `views.sql`
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
gap and should be run **before** re-applying to production:

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
| F | `vw_listing_history` exposes exactly the column set the shipped `LISTING_HISTORY_QUERY` selects, and that query (extracted from `site/lib/db/deals-query.ts`, formerly the single `site/lib/db.ts`) runs and returns history oldest-first |
| G | `snapshot_date = max(snapshot_date)` excludes the older cohort and survives a *missed run* without emptying the map |

Evidence lands in `jobs/<RunId>/evidence/assertions.txt`. Exit code 0 means every
assertion passed. If it fails, do not apply the migration.

---

## Apply order (production branch only)

The 2026-10-16 apply used exactly this order, and a re-apply should too. Stopping
between steps 2 and 3 leaves the reader without its views (H1).

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

## Post-apply verification (2026-10-16 ~13:55Z)

Applied on the production Neon branch in the documented order: step 1 migration,
step 2 views, step 3 four-object grant. Full transcript:
`jobs/tier1-migration-apply/evidence/apply.txt`.

| Check | Result |
|---|---|
| `listings.is_active` present | yes |
| `is_active` population | `active=1019 inactive=0` |
| `vw_listing_history` rows | 1,093 |
| Listings with 2 snapshots (the only drawable 2-point series today) | 74 |
| `vw_latest_listings` rows / newest-snapshot cohort | 1,019 / 1,011 (unchanged) |
| Reader `SELECT` on the four objects | `true,true,true,true` |
| Reader `SELECT` on base tables `listings`, `listing_snapshots` | denied, both |

`inactive=0` is correct at this point, not a bug: `STALE_RUNS = 3` in
`src/store/db.py` keeps deactivation a no-op until three successful runs exist,
and `pipeline_runs` holds two.

H1 was real and the runbook handled it: step 2 dropped the ACLs on the existing
views, and the step 3 re-grant restored `SELECT` on all four objects.

Method note: the owner role (`neondb_owner`) **cannot** `SET ROLE
offmarket_reader` (`ERROR: permission denied to set role`), so the privilege
check used `has_table_privilege(...)` rather than acting as the reader. That
function answers the privilege question directly, which is why the steps below
assert privileges instead of switching roles.

End to end: the deployed API now reads the new view. `GET
https://off-market-radar-nyc.vercel.app/api/listing/145558321` returns
`live:true` with a two-point series (2026-10-15 → 2026-10-16). Before the apply
that endpoint could only return `{"history": [], "unavailable": true}`.

## Verify (run after any re-apply)

As the owner:

```sql
SELECT count(*) FILTER (WHERE is_active) AS active,
       count(*) FILTER (WHERE NOT is_active) AS inactive
FROM listings;

SELECT source, listing_id, snapshot_date, price, previous_price, price_drop_pct
FROM vw_listing_history ORDER BY snapshot_date DESC LIMIT 5;
```

Then the reader's grants, **all four must be `true`**. After a `views.sql`
re-apply this is the step that catches H1, so do not skip it. `neondb_owner`
cannot `SET ROLE offmarket_reader`, so assert the privileges directly:

```sql
SELECT has_table_privilege('offmarket_reader', 'vw_latest_listings', 'SELECT'),
       has_table_privilege('offmarket_reader', 'vw_zip_price_drop_30d', 'SELECT'),
       has_table_privilege('offmarket_reader', 'pipeline_runs', 'SELECT'),
       has_table_privilege('offmarket_reader', 'vw_listing_history', 'SELECT');
```

...and these must stay **`false`** (least privilege unchanged — the base tables
stay denied):

```sql
SELECT has_table_privilege('offmarket_reader', 'listings', 'SELECT'),
       has_table_privilege('offmarket_reader', 'listing_snapshots', 'SELECT');
```

Then the site:

```powershell
curl "https://off-market-radar-nyc.vercel.app/api/listing/145558321"
```

A working apply returns `200` with `"live":true` and an oldest→newest `history`
array (2026-10-15, 2026-10-16 for that id). A body of `{"history": [],
"unavailable": true}` means the view or its grant is missing (H1); the panel
degrades rather than erroring the map.

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
