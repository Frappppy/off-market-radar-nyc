# Tier 1 migration — independent verification

Verifier: separate agent, not the one who applied the migration. Every claim below was
re-derived from the live database and the deployed site; `jobs/tier1-migration-apply/evidence/apply.txt`
was treated as a claim to check, never as evidence.

- Verification window: **2026-10-16 13:5x–14:1xZ** (DB `now()` at start of work:
  `2026-10-16 14:06:44.811925+00`; the database's `TimeZone` is `GMT`).
- Connection: owner `neondb_owner` / `neondb`, PostgreSQL **18.6**, `psql (PostgreSQL) 18.6`
  at `C:\Users\omisg\AppData\Local\Temp\opencode\pglive\Library\bin\psql.exe`.
  `DATABASE_URL` loaded from `site/.env.local` into an env var and never echoed.
- Every `psql` invocation used `-v ON_ERROR_STOP=1`.
- Writes performed: **one** — re-running `sql/migrations/2026-10-16_tier1_is_active.sql`
  (claim 5), plus statement-less `EXPLAIN` planning. No DDL/DML/GRANT/DROP otherwise.
- Scratch SQL kept at `C:\Users\omisg\AppData\Local\Temp\opencode\tier1verify\`
  (`c1.sql`…`c6.sql`, `fingerprint.sql`, `xid.sql`, `explain.sql`, `before.txt`, `after.txt`).
- `site/` was not modified. Only `site/lib/db.ts` and `site/.env.local` were read from the
  working tree; two other `site/` files (`app/api/listing/[id]/route.ts`,
  `dashboard/views.sql` at HEAD) were read **out of git's object store** with `git show`,
  which does not touch the other agent's working tree. `git status` confirms the
  concurrent editor's changes are confined to `site/`; `sql/`, `dashboard/`, `docs/`,
  `tests/` are clean.

---

## Scoreboard

| # | Claim | Verdict |
|---|---|---|
| 1 | `listings.is_active` is `boolean NOT NULL DEFAULT true`; 1019 active / 0 inactive; 0 is *correct* not broken | **VERIFIED** (with one "unproven in production" caveat on the stale path) |
| 2 | `vw_listing_history` matches `LISTING_HISTORY_QUERY`'s columns | **VERIFIED** |
| 3 | `vw_latest_listings` = original columns, original order, `is_active` + `last_seen_at` appended | **VERIFIED** |
| 4 | Reader privileges exactly right (H1); `ALTER DEFAULT PRIVILEGES` question | **VERIFIED** (privilege state); default-privileges statement **partially false** — see 4c |
| 5 | Migration is idempotent (exit 0, no state change) | **VERIFIED** — exit code **0** |
| 6 | Cohort arithmetic 1019 / 1011, 8-row difference all `Low` | **VERIFIED** (numbers and the `Low` claim); one *related doc figure* (157) is wrong |
| 7 | Deployed API agrees with the DB | **VERIFIED** for 3 of 4 sub-checks; **FAILED as specified** for the non-existent-id shape — see 7b |
| 8 | Price series end-to-end identical to the DB | **VERIFIED** (3 listings, 6 history points, 0 mismatches) |

---

## 1. `listings.is_active` — VERIFIED

**Column shape** (`c1.sql`):

```sql
SELECT ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='listings' ORDER BY ordinal_position;
```

Observed: 16 columns; ordinal **16 = `is_active | boolean | NO | true`**. Cross-checked in the
catalog (`pg_attribute`): `attnotnull = t`, `default_expr = true`, `typname = bool`,
and **`attmissingval IS NOT NULL`** — i.e. the column was added with a constant default as a
PG11+ *metadata-only* change. No table rewrite, no per-row backfill, exactly as the migration
comment claims.

**Population**:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE is_active) AS active,
       count(*) FILTER (WHERE NOT is_active) AS inactive,
       count(*) FILTER (WHERE is_active IS NULL) AS null_is_active FROM listings;
--  total | active | inactive | null_is_active
--   1019 |   1019 |        0 |              0
```

Matches the applying agent (`active=1019 inactive=0`). Zero nulls on a `NOT NULL` column
with a default — clean.

**Is `0 inactive` correct, or a broken stale path?**

```sql
SELECT status, count(*), count(started_at) FROM pipeline_runs GROUP BY status;
-- success | 2 | 2

SELECT (SELECT count(*) FROM pipeline_runs WHERE status='success') AS success_runs,
       3 AS stale_runs,
       (SELECT count(*) FROM pipeline_runs WHERE status='success') >= 3 AS gate_passes;
-- success_runs | stale_runs | gate_passes
--            2 |          3 | f
```

The loader's `_MARK_STALE` (`src/store/db.py`, `STALE_RUNS = 3`) carries a deliberate
`AND (SELECT count(*) FROM pipeline_runs WHERE status='success') >= %s` gate. With **2**
successful runs in `pipeline_runs` that gate is **false**, so the UPDATE is a no-op *by
design* (the file's own "cold-start" note). Running the real predicate as a `SELECT`:

```sql
SELECT count(*) FROM listings l
WHERE l.is_active
  AND (SELECT count(*) FROM pipeline_runs WHERE status='success') >= 3
  AND l.last_seen_at < (SELECT MIN(r.started_at) FROM
        (SELECT started_at FROM pipeline_runs WHERE status='success' AND started_at IS NOT NULL
          ORDER BY started_at DESC LIMIT 3) r);
-- 0
```

And the per-listing miss counts confirm the arithmetic is not hiding anything:

```sql
SELECT miss_count, count(*) FROM (SELECT l.listing_id,
   (SELECT count(*) FROM pipeline_runs WHERE status='success' AND started_at > l.last_seen_at) AS miss_count
 FROM listings l) t GROUP BY 1 ORDER BY 1;
--  0 | 1011      <- present in the newest successful run
--  1 |    8      <- absent from exactly ONE run
```

So the 8 not-newest-cohort listings have missed **one** run, not three. Deactivating them
would have been wrong. **`0 inactive` is correct and expected at this point — it is not a
symptom of a broken stale-marking path.**

Caveat I will not paper over: because the gate has never opened in production, the
production stale-marking path has **never executed a single row update**. Its behaviour
here is *unproven*, not *proven correct* — only the gate being closed is proven. It was
exercised locally per `docs/apply_tier1_migration.md` assertion E
(`scripts/tier1_migration_check.py`), which is a local, disposable-database result I did not
re-run. Timing, computed from the live rows rather than guessed: `mark_stale_listings` runs
*after* `finish_pipeline_run` marks the current run `success` (`src/store/cli.py` lines
176→177), so the gate opens on the **3rd** successful run — the scheduled 2026-10-17 10:00Z
run. On that run it will still change **0** rows: the cut-off is the `started_at` of the
3rd-most-recent success, which will then be `2026-10-16 06:07:43.95+00`, still newer than the
8 stale listings' `last_seen_at` of `04:48:49.88+00`. Those 8 (one miss so far) take their
second miss on Oct 17 and their third on Oct 18, so the first run that can actually flip a
row is **2026-10-18 10:00Z**.

*What would change my mind:* a successful run count ≥ 3 in `pipeline_runs` while
`mark_stale_listings` still returns 0 for listings whose `last_seen_at` predates the
N-th-newest successful run's `started_at`.

---

## 2. `vw_listing_history` vs the shipped query — VERIFIED

Extracted from `site/lib/db.ts` (`LISTING_HISTORY_QUERY`, lines 144–153), the query selects,
in order:

`source, listing_id, snapshot_date::text, price, previous_price, price_reduced,
days_on_market, price_per_sqft::float8, price_drop_pct::float8, motivation_score,
motivation_reason, scraped_at::text`

```sql
SELECT ordinal_position, column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='vw_listing_history' ORDER BY ordinal_position;
```

Observed (12 rows): `source text, listing_id text, snapshot_date date, price integer,
previous_price integer, price_reduced boolean, days_on_market integer,
price_per_sqft numeric, price_drop_pct numeric, motivation_score text,
motivation_reason text, scraped_at timestamptz`.

Every name the query selects exists, spelled identically. The three casts are compatible
(`date→text`, `numeric(10,2)→float8`, `numeric(6,2)→float8`, `timestamptz→text`) and the
types come back to JS as the `lib/types.ts` contract requires — confirmed empirically in
claim 7a/8, where `price_per_sqft: 620.82` and `price_drop_pct: 6.27` arrive as JSON
numbers, not strings. Also `count(*) FROM vw_listing_history` = 1093 = `count(*) FROM
listing_snapshots` (no rows dropped or fanned out by the view).

*What would change my mind:* a 13th column in the view, a rename, or a `numeric` column the
query forgets to cast (it would surface as a JSON string).

---

## 3. `vw_latest_listings` column order — VERIFIED

```sql
SELECT ordinal_position, column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='vw_latest_listings' ORDER BY ordinal_position;
```

Observed, 18 columns in this exact order: `source, listing_id, address, city, zip,
latitude, longitude, property_type, price, days_on_market, price_per_sqft,
price_drop_pct, motivation_score, motivation_reason, snapshot_date, url, **is_active**,
**last_seen_at**`.

Compared against the pre-Tier-1 definition, read out of git (`git show
192e5e5:dashboard/views.sql`), whose select list was exactly the first 16 names in the same
order. `docs/data_contract.md` says the same ("+ `is_active` and `last_seen_at` for
freshness filtering"). The Power BI append-only contract holds.

Side finding: `tests/test_schema_sqlglot.py::test_views_expose_is_active_and_listing_history`
only asserts `is_active`/`last_seen_at` are *present* in the `vw_latest_listings`
definition — it does **not** encode the column order or the 16-column prefix. So nothing in
the test suite would catch a future reordering of that select list. Worth a 5-line test.

*What would change my mind:* any consumer that binds columns by position and shows shifted
values (e.g. `url` receiving a timestamp).

---

## 4. Reader privileges (H1) — VERIFIED for state, with one correction

**a) Effective privileges** (`has_table_privilege` as the owner — authoritative: it resolves
ACLs including role membership and `PUBLIC`):

```sql
SELECT has_table_privilege('offmarket_reader','public.vw_latest_listings','SELECT'),
       has_table_privilege('offmarket_reader','public.vw_zip_price_drop_30d','SELECT'),
       has_table_privilege('offmarket_reader','public.pipeline_runs','SELECT'),
       has_table_privilege('offmarket_reader','public.vw_listing_history','SELECT'),
       has_table_privilege('offmarket_reader','public.listings','SELECT'),
       has_table_privilege('offmarket_reader','public.listing_snapshots','SELECT');
-- t | t | t | t | f | f
```

**b) Independent confirmation from the raw ACLs** (`pg_class.relacl`):

```
pipeline_runs          | neondb_owner=arwdDxtm/neondb_owner,offmarket_reader=r/neondb_owner
vw_latest_listings     | neondb_owner=arwdDxtm/neondb_owner,offmarket_reader=r/neondb_owner
vw_listing_history     | neondb_owner=arwdDxtm/neondb_owner,offmarket_reader=r/neondb_owner
vw_zip_price_drop_30d  | neondb_owner=arwdDxtm/neondb_owner,offmarket_reader=r/neondb_owner
listings               | NULL  (= owner only)
listing_snapshots      | NULL  (= owner only)
```

`information_schema.role_table_grants` for `offmarket_reader` returns exactly 4 rows, all
`SELECT`. Row-level security is **off** on every relation in `public`
(`relrowsecurity = false`), so nothing ambient weakens or blocks those grants. The role is
`LOGIN`, not superuser, no `BYPASSRLS`, no expiry.

**c) The `ALTER DEFAULT PRIVILEGES` claim — the runbook is wrong as literally written.**

```sql
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl;
-- cloud_admin | public | S | {neon_superuser=r*w*U*/cloud_admin}
-- cloud_admin | public | r | {neon_superuser=a*r*w*d*D*m*/cloud_admin}
```

`docs/apply_tier1_migration.md` (H1) says there is no `ALTER DEFAULT PRIVILEGES` "anywhere
in this repo", which is true of the repo (`git grep` finds the phrase only in that
sentence). But **two default-ACL rows do exist in the database** — Neon platform defaults
on objects created by `cloud_admin`, granting to `neon_superuser`. Neither keyed on
`neondb_owner` nor mentioning `offmarket_reader`, so they cannot rescue a new view's ACL.
**H1's conclusion survives**; only its literal phrasing is false. Note also that
`neondb_owner` is a member of `neon_superuser`, but that is irrelevant here: default
privileges apply to objects created *by* `cloud_admin`.

**d) Can I act as the reader? No — and I agree `has_table_privilege()` is sufficient.**

```
SET ROLE offmarket_reader            -> ERROR: permission denied to set role "offmarket_reader"
SET SESSION AUTHORIZATION offmarket_reader -> ERROR: permission denied to set session authorization
```

The applier's note is accurate, and the cause is now known rather than guessed:
`pg_auth_members` records `neondb_owner → offmarket_reader` with `inherit_option = f,
set_option = f, admin_option = t`. Without `SET` privilege the owner cannot impersonate the
role, and I have no reader credential (nothing in `site/.env.local` is usable for that; its
`DATABASE_URL` *is* the owner, as `SELECT current_user` proved).

Why I still accept this as sufficient evidence for the privilege question: two independent
mechanisms agree (`has_table_privilege`, which resolves the full grant graph, and a direct
dump of `relacl`), there is no RLS, no column-level ACLs, and the question being asked is
purely "which objects may this role SELECT".

What it does **not** establish, and I could not test:

- that the deployed Vercel app actually authenticates as `offmarket_reader` (its env is not
  readable without `vercel`, which I was forbidden to run);
- that the reader's connection succeeds at all (Neon `pg_hba`/pooler config, password
  validity) — only that the grants would allow the reads;
- that H1 actually *fired* earlier today. Postgres keeps no ACL history, so "the site was
  dark for a while and step 3 fixed it" is **not recoverable**. What is verified is that the
  end state is correct, which is the only thing that matters going forward.

*What would change my mind:* `has_table_privilege` true but a real reader connection
returning `permission denied` (would mean an ACL on a different object/branch), or the
Vercel env pointing at a different branch/role than the ones verified here.

---

## 5. Idempotency — VERIFIED, exit code **0**

The file was hashed against git before running to prove it is the committed artefact:

```
git rev-parse HEAD:sql/migrations/2026-10-16_tier1_is_active.sql  -> 7a48eb685de1839bc7e8674f3dc7690a86782d02
git hash-object sql/migrations/2026-10-16_tier1_is_active.sql     -> 7a48eb685de1839bc7e8674f3dc7690a86782d02  (identical)
git status --porcelain -- sql/ dashboard/ tests/ docs/            -> (empty: nothing modified)
```

Command and output:

```
psql -v ON_ERROR_STOP=1 -d $env:DATABASE_URL -f sql/migrations/2026-10-16_tier1_is_active.sql
BEGIN
ALTER TABLE
NOTICE:  column "is_active" of relation "listings" already exists, skipping
COMMIT
MIGRATION EXIT CODE = 0
```

No-state-change proof: a fingerprint (`fingerprint.sql` — column list+types+nullability+
defaults, all three view column lists, raw ACLs, default ACLs, row counts for all tables and
views, `is_active` population, newest cohort, the six `has_table_privilege` values, index
list, and a `sum(hashtext(...))` over every `listings` row) was captured before and after,
and `Compare-Object` reported **NO DIFFERENCES**. The `listings` checksum stayed
`-1502681482` throughout, including after the `EXPLAIN` plans in the H3 note below.

Two H2 notes, both empirically demonstrated rather than assumed:

- Control test A — `SELECT 1/0` in a file **with** `-v ON_ERROR_STOP=1`: aborts before the
  next statement, **exit 3**. Control test B — the same file **without** the flag: prints
  the error, keeps going, **exit 0**. So H2 is real, and this run was genuinely protected by
  the flag (it also bit me for real once: an early fingerprint query failed and `psql`
  exited 3, which is why the fingerprint was re-run).
- Small caveat: `ON_ERROR_STOP` does **not** stop a malformed psql *backslash* command.
  `\echo it's broken` (unbalanced quote) printed ``error: unterminated quoted string`` and
  the script **continued, exit 0**. The migration file contains no backslash commands, so it
  is unaffected — but any "apply script" that wraps the file in a `.sql` with `\echo`
  banners would silently tolerate a broken banner.

*What would change my mind:* a non-empty before/after diff, or a non-zero exit.

---

## 6. Cohort arithmetic — VERIFIED (and one doc figure is wrong)

```sql
SELECT count(*) FROM vw_latest_listings;
-- 1019   ("all-snapshot cohort")

SELECT count(*) FROM vw_latest_listings
WHERE snapshot_date = (SELECT max(snapshot_date) FROM vw_latest_listings);
-- 1011   ("newest cohort")

SELECT motivation_score, count(*) FROM vw_latest_listings
WHERE snapshot_date <> (SELECT max(snapshot_date) FROM vw_latest_listings)
GROUP BY motivation_score ORDER BY 1;
-- Low | 8
```

Both documented numbers reproduce, and the 8-row difference is **exactly** the 8 rows whose
newest snapshot is not the newest cohort, **all `Low`** — the claim holds. The 8 ids are
listed in `c3.sql` output: `2076388387, 244786279, 29799040, 30631260, 31996880, 32205804,
32333955, 32360588`, all last seen `2026-10-16 04:48:49.87986+00`, snapshot date
`2026-10-15`, all still `is_active = true` (correct — one missed run, not three).

Internal consistency: 1093 snapshot rows = 945 listings × 1 + 74 listings × 2 ✓; view dates
are only {2026-10-15: 8, 2026-10-16: 1011} ✓.

The "default map view was unaffected" claim also holds — with **and** without the recency
guard:

```sql
-- score IN ('High','Medium') AND coalesce(days_on_market,0) >= 60
with recency guard: 133     without: 133
```

**Discrepancy found in `docs/roadmap.md` (line 36–40) and
`docs/apply_tier1_migration.md` (line 36–40):** both say the default map filter is
"High+Medium with DOM ≥ 60" and then give that view as **157 rows**. 157 is what you get
with *no* DOM floor (`hm_newest = 157`); with `min_dom = 60` it is **133** — which is also
what the deployed `/api/deals?...&min_dom=60` returns and what
`jobs/tier1-ui-check/evidence/ui-verification.md` observed on `/data`. So the parenthetical
"157" contradicts the filter it is attached to. The substantive conclusion ("the 8 stale
rows were never in the default view") is still true, but the number is wrong.

*What would change my mind:* the 8 containing a non-`Low` row, or the difference count not
equalling the number of non-newest-cohort rows.

---

## 7. Deployed API vs database

Base URL `https://off-market-radar-nyc.vercel.app` (HTTP 200 throughout; no 5xx).

**7a. `/api/listing/145558321` — VERIFIED**

```json
{"listing_id":"145558321","source":"zillow","history":[
 {"source":"zillow","listing_id":"145558321","snapshot_date":"2026-10-15","price":2099000,
  "previous_price":null,"price_reduced":false,"days_on_market":9,"price_per_sqft":620.82,
  "price_drop_pct":null,"motivation_score":"Low","motivation_reason":"DOM=9<=90 AND drop=null<=5",
  "scraped_at":"2026-10-15 02:46:34+00"},
 {"source":"zillow","listing_id":"145558321","snapshot_date":"2026-10-16","price":2099000,
  "previous_price":null,"price_reduced":false,"days_on_market":10,"price_per_sqft":620.82,
  "price_drop_pct":null,"motivation_score":"Low","motivation_reason":"DOM=10<=90 AND drop=null<=5",
  "scraped_at":"2026-10-16 05:55:18+00"}],
 "latest_snapshot_date":"2026-10-16","live":true}
```

`live: true`, exactly **2** history points, oldest first. Byte-for-byte identical to the
applier's capture — and, independently, to the database (see claim 8). This is the check
that was impossible before today: `jobs/tier1-ui-check/evidence/ui-verification.md` (line 87)
records the panel's populated path as "stub-verified only" because the view was ungranted.

**7b. Non-existent listing id — FAILED as specified (but the route does not error)**

```
GET /api/listing/999999999999  -> HTTP 200
{"listing_id":"999999999999","source":"zillow","history":[],"latest_snapshot_date":null,"live":true}
```

Expected per my brief: `history: [], live:false, unavailable:true`. Observed: `history: []`
✓, `latest_snapshot_date: null` ✓, but **`live:true`** and **no `unavailable` field at all**.
The route degrades rather than erroring — the stated *intent* is met — but the stated field
values are not.

Explanation from the shipped source (`git show 'HEAD:site/app/api/listing/[id]/route.ts'`,
read from git, not from the concurrently-edited working tree): the handler sets `live: true`
on **any** successful query, including one that returns zero rows, and only sets
`live:false, unavailable:true` in the `catch`. So after the grant, `unavailable:true` is
effectively **unreachable for a missing listing** — it now means "the DB read threw", not
"nothing found". The brief's expectation (and `docs/apply_tier1_migration.md`'s "Before the
grant: ... `{"history":[],"unavailable":true}`") describes the *pre-grant* fallback, which is
what `ui-verification.md` line 54 actually observed at the time.

Not a data defect; it is a naming/semantics gap: a client cannot distinguish "this id has no
history" from "the history read failed" *if it only looks at `live`* — it must look at the
presence of `unavailable`. Worth a one-line comment or a `reason` field (already queued as
S-4 in `ui-verification.md`).

**7c. `/api/deals?score=High,Medium&min_dom=60&limit=500` — VERIFIED**

`HTTP 200`, `deals` array of **133**, `count: 133`, `live: true`, `window_days: 0`,
`latest_snapshot_date: "2026-10-16"`. Stronger than the row count:

- the **set** of 133 `listing_id`s from the API is *identical* to the set from
  `vw_latest_listings` with the same filters (`Compare-Object` → ID SETS IDENTICAL);
- **0 field mismatches across all 133 rows** when comparing `address, city, zip,
  property_type, price, days_on_market, price_per_sqft, price_drop_pct, motivation_score`
  against the database;
- 133 unique ids (no duplication), all `snapshot_date = 2026-10-16`, motivation only
  `High`/`Medium`, `days_on_market` 64…847 (so the `min_dom=60` filter bites), ordering
  High-then-Medium then DOM descending as `buildDealsQuery` specifies;
- no `is_active` field in the payload — consistent with `DEALS` not selecting it (the
  recency guard, not the column, is what's live).

**7d. `/api/health` — VERIFIED internally consistent**

```json
{"live":true,"last_success":{"run_id":"20261016-055515","finished_at":"2026-10-16 06:07:44.532607+00",
 "records_loaded":1011},"last_failure":null,"next_run_at":"2026-10-17T10:00:00.000Z","cron":"0 10 * * *",
 "runs_ok_30d":2,"runs_failed_30d":0,"latest_snapshot_date":"2026-10-16","snapshot_days":2,
 "tracked":1011,"market_reference":22801,"coverage_pct":4.4}
```

- `tracked = 1011` — **equals the newest-snapshot cohort, not `count(*)` of the view
  (1019)**. Exactly the property the brief asked about: the health card does not overstate
  coverage by counting stale rows.
- `snapshot_days = 2` = the 2 distinct dates in the view ✓; `latest_snapshot_date` ✓;
  `runs_ok_30d = 2`, `runs_failed_30d = 0` ✓ against `pipeline_runs` (2 rows, both
  `success`); `last_success.run_id` / `finished_at` / `records_loaded` match that row exactly
  (no failed run exists, so `last_failure: null` ✓); `next_run_at 2026-10-17T10:00:00Z` ✓
  consistent with `cron 0 10 * * *` and the current UTC time; `coverage_pct 4.4` =
  1011/22801 = 4.435% ✓ (rounded).
- Not independently verifiable: that `22801` is the right market denominator. It lives in
  site code outside my read allowance and is documented as "stated as a sample"; I verified
  only that the arithmetic using it is right.

Note `/api/health`'s `live:true` here means "the DB answered", unlike 7b where the same
field name appears in a different object — same word, two meanings. Worth a footnote in the
API docs.

*What would change my mind:* the deals id set differing by even one row from the SQL, or
`tracked` equalling 1019.

---

## 8. End-to-end number cross-check — VERIFIED

Three listings, including two with real price movement, all fields compared
(`source, listing_id, snapshot_date, price, previous_price, price_reduced, days_on_market,
price_per_sqft, price_drop_pct, motivation_score, motivation_reason, scraped_at`):

| listing | points | order | mismatches |
|---|---|---|---|
| `145558321` | 2 | 2026-10-15 → 2026-10-16 | 0 |
| `2056733785` (reduced 319000→299000, −6.27%) | 2 | 2026-10-15 → 2026-10-16 | 0 |
| `30776634` (1049999→1049000→999000) | 2 | 2026-10-15 → 2026-10-16 | 0 |

**HISTORY MISMATCHES: 0** of 6 history points. Example (`30776634`), API vs
`vw_listing_history`, both rows identical including the `null` `price_per_sqft`, the
`previous_price` carried forward (1049000), the changing `price_drop_pct` (0.1 → 4.77) and
the `motivation_reason` rule trace (`drop=0.1%<=5` → `drop=4.8%<=5`). The deployed app is
reading the same database I am, row for row. (`True`/`False` capitalisation is a PowerShell
rendering artefact, identical on both sides of each comparison.)

*What would change my mind:* any field differing on any point, or a history array not sorted
oldest-first.

---

## Beyond the brief — H3 forward compatibility (checked, holds)

The runbook's H3 is "the pipeline needs the column before its next run". The live database
satisfies the loader now: planning the **real** `_INSERT_LISTING` text (dumped from
`src.store.db`, not retyped) against production —

```
EXPLAIN INSERT INTO listings (source, listing_id, address, city, state, zip, latitude,
  longitude, property_type, bedrooms, bathrooms, living_area_sqft, url) VALUES (...)
  ON CONFLICT (source, listing_id) DO UPDATE SET address = EXCLUDED.address,
  is_active = true, last_seen_at = now();
-> Insert on listings  Conflict Resolution: UPDATE
   Conflict Arbiter Indexes: listings_pkey

EXPLAIN INSERT INTO listing_snapshots (...) ON CONFLICT (source, listing_id, snapshot_date) DO UPDATE SET ...
-> Insert on listing_snapshots  Conflict Arbiter Indexes: listing_snapshots_source_listing_id_snapshot_date_key
```

`EXPLAIN` without `ANALYZE` does not execute; re-checked afterwards — `listings=1019`,
`snapshots=1093`, `fake_row_present=0`, checksum unchanged. Also worth noting for H3:
`is_active` is deliberately **not** in `LISTING_COLUMNS` (`src/store/mapping.py`), so new
rows take the column DEFAULT and only conflicting rows get `is_active = true` from the
upsert — which is exactly why the DEFAULT being present and non-null matters, and it is.

One forward-looking risk, stated plainly: **neither production load so far ran the Tier 1
code path.** Transaction-id forensics (`pg_attribute.xmin`) settle a question the applying
agent's log leaves ambiguous — their pre-check claimed the column was absent before the
migration, and that is corroborated:

```
listings.first_seen_at / last_seen_at attribute rows created by xid 2049 (CREATE TABLE)
listings.is_active                     attribute row created by xid 12289
row versions in listings:  xid 2050 (8 rows, the 04:48Z load), xid 5125 (1011 rows, the 06:07Z load)
row versions in snapshots: xid 2050 (82),                            xid 5125 (1011)
pg_class.listings xmin = 12289
```

12289 is later than both load transactions, so `is_active` was **not** created by the
loader's `apply_schema` guard and **not** during either load — it was created by the manual
migration (`xid 12289` is the step-1 `ALTER TABLE`, which also bumped the `listings`
`pg_class` row). My own re-run was a true no-op and did not touch it. (Immaterial to
correctness — the column exists either way — but it means the loader's upgrade guard has
never actually fired in production, and the next scheduled run at 2026-10-17 10:00Z is the
first that will exercise Tier 1 store code. The `EXPLAIN` above is my evidence that it will
not fail.)

---

## Evidence defect in the applying agent's artefact

`jobs/tier1-migration-apply/evidence/apply.txt` is headed
`PRODUCTION MIGRATION APPLY - 2026-10-16 19:54:53Z`, and the appended verification is
`2026-10-16 19:55:45Z`. Those are **local times mislabelled as UTC**:

- file mtime (UTC): `2026-10-16 13:54:53Z` / `13:55:45Z`;
- the host is at UTC+06:00 (`machine local 2026-10-16 20:06:45 +06:00` = `14:06:45Z`);
- the database itself agrees: `SELECT now()` → `2026-10-16 14:06:44.811925+00` (`TimeZone = GMT`).

So the migration was applied at **~13:54Z, roughly six hours earlier than the "~19:55Z" that
my brief (and any downstream note) states**. Nothing about the migration's correctness
depends on it, but an audit trail that stamps local time with a `Z` is a defect worth
fixing, and it is the kind of number that later gets correlated against `pipeline_runs`
(which *is* UTC) and produces a bogus conclusion.

---

## Checks I could NOT perform (stated, not buried)

1. **Acting as `offmarket_reader`.** `SET ROLE` and `SET SESSION AUTHORIZATION` are both
   denied (membership has `set_option = f`), and no reader credential exists on this machine.
   I agree `has_table_privilege()` is sufficient *for the privilege question*, because
   `pg_class.relacl` independently agrees and RLS is off. It is **not** sufficient to prove
   the deployed app authenticates as that role, or that a reader connection would succeed at
   all.
2. **Reproducing H1.** Re-applying `dashboard/views.sql` (the only way to watch the ACLs
   vanish and be restored) is DDL — forbidden here. H1's *end state* is verified; the claim
   that it fired and was corrected is not recoverable, since Postgres keeps no ACL history.
3. **Verifying the deployed build's commit / env.** No `vercel` commands allowed, and the
   Vercel environment is not readable locally. I inferred "the deployment reads the same
   database state" from exact 133-row id-set and field equality plus matching `/api/health`
   numbers — strong, but inference, not direct inspection.
4. **Running `scripts/tier1_migration_check.py` / `pytest`.** Out of scope for these eight
   claims (and it would write cache files outside my evidence path). The stale-marking
   path's correctness therefore rests on local assertions I did not reproduce, plus the SQL
   reasoning in claim 1.
5. **`market_reference = 22801`.** Arithmetic checked; the denominator itself is a
   documented sample sourced from site code I was not allowed to read.
6. **Verifying when `is_active` was created** is only possible via the transaction-id
   forensic above; Postgres has no DDL timestamps, and `pg_attribute` has no creation date.

---

## Verdict

**PASS.** All eight claims verify as stated, with three documented exceptions that are
documentation-level, not data-level:

1. The "non-existent listing degrades to `live:false, unavailable:true`" expectation is
   **wrong for the code as shipped** — it returns `200` with `history: []`, `latest_snapshot_date: null`
   and `live: true` (the `unavailable` shape is the pre-grant *error* fallback). Graceful
   degradation works; the field values differ from the brief.
2. `docs/roadmap.md` and `docs/apply_tier1_migration.md` both say the default map view is
   "High+Medium with DOM ≥ 60" and give it as **157** rows. With `min_dom=60` it is **133**;
   157 is the no-DOM-floor count. The "unaffected by the 8 stale rows" conclusion is
   unaffected.
3. The runbook's "there is no `ALTER DEFAULT PRIVILEGES` anywhere" is true of the repo and
   false of the database (two exist, `cloud_admin`→`neon_superuser`). H1's determinism
   conclusion still holds.

Plus one evidence-hygiene defect (apply.txt labels local time as `Z`, ~6 h off) and one
real forward-looking caveat (the stale-marking UPDATE has never executed in production
because only 2 of the required 3 successful runs exist; the gate first opens on the
2026-10-17 10:00Z run, where it will still change 0 rows, and the first row it can actually
flip is on 2026-10-18).

Nothing found in the database or the live API contradicts the applying agent's numbers:
`1019/0`, `1019/1011`, `133`, `1093`, `true,true,true,true,false,false`, exit 0 are all
reproduced independently.
