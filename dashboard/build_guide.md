# Build guide — Off-Market Deal Finder Power BI dashboard (Stage 4)

Click-by-click instructions for someone who does **not** use Power BI daily.
Estimated time: 30–45 minutes.

**Reference style used in this guide:** measures are always written in DAX
reference form — the exact measure name wrapped in square brackets, e.g. the
measure defined as `High Motivation Count` is invoked with square brackets
around that name in formulas, filters and fx dialogs. Square brackets in this
guide therefore only ever wrap a measure name or a DAX-qualified column name
(such as `vw_zip_price_drop_30d` followed by the `zip` column) — the verifier
relies on this convention. Columns, view names and file names are otherwise
written in code font. `dashboard/verify_contract.py` checks the convention
automatically.

**Files in this package**

| File | What it is |
|---|---|
| `views.sql` | Two Postgres/Neon views the dashboard reads (apply once to the DB) |
| `dax_measures.dax` | Six measures to paste into Power BI (Home → New measure) |
| `build_guide.md` | This file |
| `verify_contract.py` | Repo-side verification (SQL parse, DDL cross-check, measure cross-check) |

> **Secrets:** every credential below is a **placeholder**. Copy real values
> from the Neon Console at build time; never write real passwords into any
> repository file (this project keeps secrets in gitignored `config/*.local.env`).

---

## Step 0 — Prerequisites

1. **Power BI Desktop**, free from the Microsoft Store (`Microsoft Power BI Desktop`).
   This guide targets the current (2025/2026) build; where wording differs
   between builds it is flagged as *version-dependent*.
2. A **Neon** Postgres database where:
   - the Stage 3 schema from `docs/data_contract.md` (`sql/schema.sql`) is applied, **and**
   - the pipeline has loaded at least one run of data (otherwise every visual renders empty).
3. `dashboard/views.sql` applied — see Step 1.

### Placeholder connection details (Neon Console → your project → **Connect**)

| Item | Placeholder / value |
|---|---|
| Server (host) | `ep-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.neon.tech` |
| Port | `5432` (Neon default; Power BI has no separate port box — see note below) |
| Database | `<your_database>` (e.g. `neondb`) |
| User / role | `<your_role>` (e.g. `alex`) |
| Password | `<your_password>` |
| SSL | **required** — `sslmode=require` |

Neon builds the whole string for you:
`postgresql://<user>:<password>@ep-xxxx.neon.tech:5432/<database>?sslmode=require` —
use it as the source of truth for the fields above.
*Port note:* leave the Server field as the plain host for port 5432; if your
build needs an explicit port, use `ep-xxxx.neon.tech:5432`.

*Neon tip:* for BI/long connections Neon recommends a **read replica** (Connect
modal → switch branch/role) so dashboard refreshes do not compete with the
scraper writes.

---

## Step 1 — Apply the dashboard views to the database

Either:

- **Neon Console → SQL editor** → paste the entire contents of
  `dashboard/views.sql` → **Run**, or
- `psql "$DATABASE_URL" -f dashboard/views.sql`

This creates (idempotent — safe to re-run):

- `vw_latest_listings` — one row per listing: its **latest** snapshot joined
  with address/city/zip/lat/lng/property_type/url. Drives map, cards, table.
- `vw_zip_price_drop_30d` — `avg(price_drop_pct)` + count per zip per
  `snapshot_date`, last 30 days. Drives the trend line.

Quick check in the SQL editor: `SELECT count(*) FROM vw_latest_listings;` →
should be > 0 after a successful pipeline run.

---

## Step 2 — Get Data → PostgreSQL, load both views (Import mode)

1. Open Power BI Desktop → **Home** tab → **Get data** → **More…** →
   **Database** → **PostgreSQL database** → **Connect**.
2. Fill the dialog:
   - **Server:** `ep-xxxx.neon.tech`
   - **Database:** `<your_database>`
   - **Data connectivity mode:** **Import** (required for this design —
     everything below assumes an imported model refreshed on demand)
   - *Advanced options* (foldout): leave empty — we load whole views, no SQL.
3. **Credentials:** authentication type **Database** (username and password) →
   enter `<your_role>` / `<your_password>` → **OK / Connect**.
4. **Require SSL.** Neon refuses non-SSL connections, so keep encryption
   **ON** in the credentials dialog (the control is labelled *Require SSL* or
   *Use Encrypted Connection* depending on build — **never uncheck it**).
   - If your build shows no SSL control, force it after loading:
     **Home → Transform data → Power Query Editor → Advanced Editor** and make
     sure the `PostgreSQL.Database(...)` call carries the options
     `UseSSL=true` and `SSLMode="Require"` (comma-separated inside its final
     options record).
   - If Windows reports a certificate error, add Neon's certificate to the
     machine's *Trusted Root Certification Authorities* — do **not** disable SSL.
5. **Navigator:** expand the database and tick **both**
   - `vw_latest_listings`
   - `vw_zip_price_drop_30d`
   (they show a *view* icon. If you see no views: cancel → Get data →
   PostgreSQL → Advanced options → tick **Navigate using full hierarchy** → retry)
   → **Load**.
6. Sanity check: **Table view** (left rail) → click each table → the row count
   column shows rows; `snapshot_date` has dates.

### Import mode, refresh, gateway, Pro/workspace note

- **Import** copies the view results into your `.pbix`. Later refreshes re-run
  the two view queries against Neon.
- **On this machine (local .pbix):** refresh is **manual** — Home → **Refresh**.
  Power BI Desktop has no scheduler.
- **In the Power BI service (after Publish):** open the workspace → dataset →
  **Settings → Data source credentials** → sign in to PostgreSQL (Database auth).
  Scheduled refresh then needs:
  - a **gateway** if the service cannot reach the source directly — the
    *on-premises data gateway* may run on your own PC and reach Neon over the
    internet (add a PostgreSQL data source: host `ep-xxxx.neon.tech`, port
    `5432`, SSL on, your credentials); some tenants allow direct cloud
    connectivity instead, in which case no gateway is prompted;
  - a **Pro (or Premium/Fabric) workspace**: Free workspaces cannot schedule
    refresh; Pro allows up to **8 scheduled refreshes/day**. Without Pro you
    can still publish and refresh manually (**Refresh now**).

---

## Step 3 — Create the six measures

For each measure: **Home → New measure**, then paste the single
`Name = expression` line from `dax_measures.dax` (skip the `//` comment lines;
strip them if your formula bar rejects comments on paste).

| Measure (exact name, shown here in DAX reference form) | What it gives you |
|---|---|
| `[Property Count]` | DISTINCTCOUNT of `listing_id` on the latest view |
| `[High Motivation Count]` | count where `motivation_score` equals `"High"` |
| `[Avg Price Drop %]` | mean `price_drop_pct` (latest snapshots) |
| `[Avg DOM]` | mean `days_on_market` (latest snapshots) |
| `[Is DOM > 60]` | `1/0` flag: average DOM above 60 days |
| `[Avg Price Drop % (30d)]` | trend Y axis, from `vw_zip_price_drop_30d` |

Table names in the formulas must match the Data pane (if the pane shows
`public.vw_latest_listings`, edit the quoted names accordingly).

**Formatting (select the measure → Measure tools tab):**

- `[Avg Price Drop %]` and `[Avg Price Drop % (30d)]` → Format → **Custom** →
  `0.0"%"` (the data already stores percentage points: `7.1` = 7.1 %).
- `[Property Count]`, `[High Motivation Count]`, `[Avg DOM]` → **Whole number**.
- `[Is DOM > 60]` → **Whole number** (used in filters/fx, normally not on canvas).

---

## Step 4 — Data categories (1 minute, prevents a broken map)

**Table view** → click a column → **Column tools → Data category**:

- `latitude` → **Latitude**, `longitude` → **Longitude** (in *both* tables if shown twice)
- `zip` → **Postal Code**

---

## Step 5 — Map visual (map with clustering)

**Visual:** Azure Maps (Visualizations pane icon). If it is missing:
**Get more visuals → AppSource → "Azure Maps" (Microsoft)**.

Location is provided by the coordinate buckets — the Azure Maps equivalent of
a Location well; the *Location* well itself is only for address text that
Power BI must geocode, which we do not need because we already have
`latitude`/`longitude`.

**Exact field list (Azure Maps buckets):**

| Bucket | Field |
|---|---|
| Latitude | `latitude` |
| Longitude | `longitude` |
| Legend | `motivation_score` |
| Size | `price` (bubble size = price; if asked for aggregation → **Sum**) |
| Tooltips | `address`, `city`, `zip`, `property_type`, `days_on_market`, `price_drop_pct`, `motivation_reason` |

Notes:

- With `motivation_score` in **Legend**, a **Data colors** section appears in
  the Format pane: set **High = red**, **Medium = amber**, **Low = grey**.
- **Clustering:** Format visual (brush icon) → layer settings → turn the
  **Cluster bubble layer** **On** (labelled *Cluster bubble layer* / under
  *Map settings* in current builds — *version-dependent*). Zooming out collapses
  nearby points into numbered cluster bubbles; zooming in splits them into
  individual markers still colored by `motivation_score`, so you can spot
  clusters of high-motivation properties first, then drill in.
  *Honest limitation:* a cluster's number counts **all** listings in range
  regardless of color; color differentiation appears at marker level.
- Optional: Format → Map style → Road / Satellite.

**Fallback if Azure Maps is unavailable:** classic **Map** visual —
Location → `address`, Latitude → `latitude`, Longitude → `longitude`,
Bubble size → `price`, Legend → `motivation_score`.
*Honest limitation:* the classic visual has **no** zoom clustering.

---

## Step 6 — Trend line (last-30-days price drop by ZIP)

**Visual:** Line chart.

**Exact field list:**

| Well | Field |
|---|---|
| X axis | `snapshot_date` from `vw_zip_price_drop_30d` |
| Y axis | measure `[Avg Price Drop % (30d)]` |
| Legend (Series) | `zip` |
| Tooltips | `listing_count` |

Steps / gotchas:

1. Power BI inserts a **Date hierarchy** (Year/Quarter/Month/Day) on the X
   axis automatically. Click the `snapshot_date` field in the X-axis well →
   choose **Date** (the plain field), not the hierarchy — the axis must be
   daily for this chart.
2. **Visual-level filter** (Filters pane → *Filters on this visual*):
   `snapshot_date` → **Relative date** → **is in the last** → `30` → **days**.
   The SQL view already restricts to 30 days; keep this filter as a safety net
   in case the view definition is ever widened.
3. Formatting: Y axis → Values → **Custom** `0.0"%"`; Title
   “Avg price drop % by ZIP — last 30 days”; turn markers **On**.

---

## Step 7 — Slicer, and wiring it to map AND trend

### 7a. Primary: `days_on_market` numeric slicer (> 60)

1. **Slicer** visual → drag `days_on_market` (from `vw_latest_listings`) into it.
2. Slicer header type dropdown → **Greater than** → enter `60`.
   - Build without “Greater than”: keep **Between** and set the lower box to
     `60`, **or** skip the slicer and add a visual-level filter
     `days_on_market` **is greater than** `60` on the map/table instead.
3. Effect: the **map and table filter immediately** (they read the same table).

### 7b. Wire the slicer to the trend (relationship)

The two views are separate tables; Power BI does not cross-filter unrelated
tables. Create one relationship:

1. **Model view** → drag `vw_zip_price_drop_30d[zip]` onto
   `vw_latest_listings[zip]`.
2. In the relationship dialog set:
   - Cardinality: **Many to many**
   - Cross-filter direction: **Both**
   - Make this relationship active ✓
   (Power BI may auto-detect it on load — verify the line exists; if it comes
   in single-direction, edit it to **Both**.)
3. **Format → Edit interactions** (with the slicer selected): confirm the
   trend chart shows the **Filter** icon (default). Now the
   `days_on_market > 60` slicer affects **map and trend**.

> **Honest semantic note:** `vw_zip_price_drop_30d` is *pre-aggregated* per
> zip/day. The slicer therefore decides **which ZIPs appear** in the trend
> (ZIPs with no matching listings drop out); it does **not** recompute each
> ZIP's average using only the filtered listings. Recomputing from filtered
> rows would require modelling the detail table as a time series, which is out
> of scope for this package.

### 7c. Alternative using the measure `Is DOM > 60`

- **Row-level vs whole-visual:** filtering the *column* `days_on_market`
  removes individual rows (7a). The *measure* `[Is DOM > 60]` evaluates to a
  single 0/1 for the visual's current context, so it switches whole visuals:
  - **Visual-level filter:** Filters pane → drag `[Is DOM > 60]` onto the
    map's (or table's) *Filters on this visual* → set it to `1`. The visual
    displays only while average DOM in context exceeds 60 days.
  - **Conditional formatting of the `[Avg DOM]` card:** Format visual →
    Callout value → **fx** → Format style *Rules* → *Based on field*:
    `[Is DOM > 60]` → rule `1` → red text, else dark grey.
  - **Measure slicer (version-dependent):** recent builds accept measures in a
    Slicer visual — drop `[Is DOM > 60]` into a slicer and pick `1`. If your
    build's slicer refuses measures, use the two options above; this could not
    be verified without a Power BI GUI here.

---

## Step 8 — Cards and suggested layout

### Cards (exact field list)

| Card | Field | Title | Notes |
|---|---|---|---|
| 1 | `[Property Count]` | Latest listings | whole number |
| 2 | `[High Motivation Count]` | `Motivation_Score = High` | the required high-motivation card |
| 3 | `[Avg DOM]` | Avg DOM (days) | fx on Callout value based on `[Is DOM > 60]` → 1 = red |
| 4 | `[Avg Price Drop %]` | Avg price drop | format `0.0"%"` |

### Table visual (bottom) — exact column list from `vw_latest_listings`

`address`, `city`, `zip`, `property_type`, `price`, `days_on_market`,
`price_drop_pct`, `motivation_score`, `motivation_reason`, `snapshot_date`,
`url`

Formatting: `price` → currency (whole), `price_drop_pct` → `0.0"%"`;
sort by `motivation_score` then `days_on_market` descending; optional
background-color fx on `motivation_score` (High = red).

### Suggested layout (Widescreen 16:9)

```
+--------------------------------------------------------------------+
|  Off-Market Deal Finder — Motivated Seller Radar                   |
+----------------+---------------------------------------------------+
|  S L I C E R   |  (Property Count)   (High Motivation Count)       |
|  days_on_market|  (Avg DOM)          (Avg Price Drop %)            |
|  Greater than 60                                                |
|  (zip dropdown, |   MAP (Azure Maps, clustered)  |  TREND (line)   |
|   optional)     |   ~55% width                  |  ~40% width      |
|                 |                                |                  |
+----------------+---------------------------------------------------+
|  TABLE: address … url (full width)                                 |
+--------------------------------------------------------------------+
```

Card titles (top-right of each card): “Latest listings”,
`Motivation_Score = High`, “Avg DOM (days)”, “Avg price drop”.

- Left rail holds the slicers; KPI cards across the top; map is the hero
  visual; trend beside it; detail table at the bottom.
- Optional extra slicer: `zip` (dropdown) — it cross-filters both sides
  through the Step 7b relationship.

---

## Step 9 — Quick reference: every visual's field list

| Visual | Well / bucket | Field |
|---|---|---|
| Map (Azure Maps) | Latitude | `latitude` |
| Map | Longitude | `longitude` |
| Map | Legend | `motivation_score` |
| Map | Size | `price` (Sum) |
| Map | Tooltips | `address`, `city`, `zip`, `property_type`, `days_on_market`, `price_drop_pct`, `motivation_reason` |
| Trend line | X axis | `snapshot_date` (plain Date, not hierarchy) |
| Trend line | Y axis | `[Avg Price Drop % (30d)]` |
| Trend line | Legend | `zip` |
| Trend line | Tooltips | `listing_count` |
| Trend line | Visual filter | `snapshot_date` relative date last 30 days |
| Slicer | Field | `days_on_market` — type **Greater than** 60 |
| Slicer (alt.) | Visual filter | `[Is DOM > 60]` = 1 |
| Card 1 | Value | `[Property Count]` |
| Card 2 | Value | `[High Motivation Count]` (title `Motivation_Score = High`) |
| Card 3 | Value | `[Avg DOM]` (fx rules on `[Is DOM > 60]`) |
| Card 4 | Value | `[Avg Price Drop %]` |
| Table | Columns | `address`, `city`, `zip`, `property_type`, `price`, `days_on_market`, `price_drop_pct`, `motivation_score`, `motivation_reason`, `snapshot_date`, `url` |

Tables used: map/cards/table/slicer → `vw_latest_listings`;
trend → `vw_zip_price_drop_30d`.

---

## Step 10 — What was verified here, and what was not

**Verified inside this repository** (from this folder, run
`..\.venv\Scripts\python.exe dashboard/verify_contract.py` — exact output is in
the Stage 4 report):

1. `sqlglot.parse(open('dashboard/views.sql').read(), dialect='postgres')`
   succeeds → the views are syntactically valid Postgres.
2. Every table/column referenced in `views.sql` exists in the Stage 3 DDL in
   `docs/data_contract.md` (programmatic cross-check, per-reference PASS/FAIL).
3. Measure cross-check, both directions: every measure named in this guide
   (written in the bracketed form defined at the top) exists in
   `dax_measures.dax`, and every measure defined there is referenced here;
   additionally every column used inside the DAX exists in `views.sql`.

**Not verifiable in this environment (no Power BI GUI here) — labelled honestly:**

- All click paths, dialog labels and pane names may differ slightly between
  Power BI builds (flagged *version-dependent* above): Get Data dialogs, SSL
  control wording, Azure Maps cluster-bubble toggle location, measure slicer
  support, conditional-formatting dialogs.
- Visual rendering, map geocoding results, gateway installation and
  scheduled-refresh behaviour in a real tenant.
- End-to-end data appearance (depends on Stage 3 having loaded rows).

**Deliberately skipped:** `pbip/` (text-format Power BI project). A wrong
TMDL/PBIR file layout produces a project that fails to open — worse than
having none. Build the report by following this guide; the `.pbix` you save
locally is the artifact.

**Known data caveats:** listings with `zip IS NULL` are excluded from
`vw_zip_price_drop_30d` (a blank legend value would break the trend);
`[Avg Price Drop %]` ignores NULL `price_drop_pct`; the 30-day trend is
pre-aggregated (see the semantic note in Step 7b).
