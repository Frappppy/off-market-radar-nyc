# Data contract — Project 1: The Off-Market Real Estate Deal Finder

All four stages communicate **only** through this document. Field names and CLI
signatures are exact. Any stage that changes this contract must update this file.

## Shared conventions

- `run_id`: UTC timestamp `YYYYMMDD-HHMMSS` (e.g. `20261014-143000`).
- Data lands in `jobs/<run_id>/…`. Every stage writes `<out>/manifest.json`:
  `{"stage", "run_id", "records_in", "records_out", "started_at", "finished_at", "status"}`.
- Every stage logs human-readable progress to `<out>/process_log.md`.
- Timezone: all timestamps ISO 8601 UTC. Money: USD integers. Dates: `YYYY-MM-DD`.
- Secrets (`DATAIMPULSE_*`, `DATABASE_URL`) come ONLY from env or gitignored
  `config/*.local.env`. Never in code, logs, output, or commits.

## CLI contracts (the orchestrator `scripts/run_daily.py` calls these)

```
py -3 -m src.scrape   --pages 5 --max-details 150 --out jobs/<run_id>/raw
py -3 -m src.clean    --in  jobs/<run_id>/raw     --out jobs/<run_id>/cleaned
py -3 -m src.store    --in  jobs/<run_id>/cleaned            # needs DATABASE_URL
```
Exit 0 = success. `src.store` must fail fast with a clear message if `DATABASE_URL` is unset.

## Stage 1 — raw JSONL: `jobs/<run_id>/raw/listings.jsonl` (one object per line)

| field | type | notes |
|---|---|---|
| source | str | `"zillow"` |
| listing_id | str | Zillow zpid |
| url | str | homedetails URL (robots-allowed path) |
| address_raw | str | exactly as scraped |
| city | str | e.g. `New York`, `Brooklyn` |
| state | str | 2-letter |
| zip | str\|null | |
| latitude | float\|null | needed for map |
| longitude | float\|null | needed for map |
| price_current | int\|null | USD |
| price_previous | int\|null | prior list price if known |
| price_reduced | bool | site "Price cut" flag OR `price_previous > price_current` |
| property_type | str | one of: `house`, `condo`, `co-op`, `townhouse`, `multi-family`, `land`, `other` |
| bedrooms | float\|null | |
| bathrooms | float\|null | |
| living_area_sqft | int\|null | |
| days_on_market | int\|null | DOM if present |
| listed_date | str\|null | `YYYY-MM-DD` |
| price_history | list\|null | `[{date, price, event}]` raw audit trail from price-history section |
| scraped_at | str | ISO 8601 UTC |

Also in `raw/`: `pages_fetched.json` (url, status, fetched_at per request — audit trail)
and `manifest.json`.

## Stage 2 — clean: `jobs/<run_id>/cleaned/listings_<snapshot_date>.parquet` (+ same `.csv`)

All raw fields **plus**:

- `address_std` str — uppercase, whitespace collapsed, trimmed.
- `snapshot_date` date — UTC date of the scrape (from `scraped_at`).
- `price_per_sqft` float\|null = `price_current / living_area_sqft` (null if sqft null/0).
- `price_drop_abs` int\|null = `price_previous - price_current`.
- `price_drop_pct` float\|null = `price_drop_abs / price_previous * 100` (null if either missing).
- `motivation_score` str ∈ {`High`, `Medium`, `Low`}.
- `motivation_reason` str — short rule trace, e.g. `"DOM=112>90 AND drop=7.1%>5"`.

**Motivation rules (null-safe: missing DOM treated as ≤ 90, missing drop as ≤ 5%):**
- `High`   — `days_on_market > 90` AND `price_drop_pct > 5`
- `Medium` — not High AND (`days_on_market > 90` OR `price_drop_pct > 5`)
- `Low`    — otherwise

## Stage 3 — SQL (Postgres: Neon locally testable fallback)

```sql
CREATE TABLE listings (
  source            text NOT NULL,
  listing_id        text NOT NULL,
  address           text,
  city              text,
  state             text,
  zip               text,
  latitude          double precision,
  longitude         double precision,
  property_type     text,
  bedrooms          numeric,
  bathrooms         numeric,
  living_area_sqft  integer,
  url               text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, listing_id)
);

CREATE TABLE listing_snapshots (
  snapshot_id       bigserial PRIMARY KEY,
  source            text NOT NULL,
  listing_id        text NOT NULL,
  snapshot_date     date NOT NULL,
  price             integer,
  previous_price    integer,
  price_reduced     boolean,
  days_on_market    integer,
  price_per_sqft    numeric(10,2),
  price_drop_pct    numeric(6,2),
  motivation_score  text NOT NULL CHECK (motivation_score IN ('High','Medium','Low')),
  motivation_reason text,
  scraped_at        timestamptz NOT NULL,
  FOREIGN KEY (source, listing_id) REFERENCES listings (source, listing_id),
  UNIQUE (source, listing_id, snapshot_date)
);

CREATE TABLE pipeline_runs (
  run_id           text PRIMARY KEY,
  started_at       timestamptz,
  finished_at      timestamptz,
  status           text,           -- running | success | failed
  source           text,
  records_scraped  integer,
  records_loaded   integer,
  notes            text
);
-- required indexes: listing_snapshots(snapshot_date), listing_snapshots(zip-joined via listings(zip)) => listings(zip)
```

**Upsert semantics (idempotent daily append):**
- `listings`: `ON CONFLICT (source, listing_id) DO UPDATE` → refresh mutable
  fields + `last_seen_at = now()`.
- `listing_snapshots`: `ON CONFLICT (source, listing_id, snapshot_date) DO UPDATE`
  (a same-day re-run corrects rows, never duplicates).
- Exactly one `pipeline_runs` row per run, updated to `success`/`failed`.

Dashboard views live separately in `dashboard/views.sql` (owned by the Power BI
stage, applied after `sql/schema.sql`):

```sql
-- vw_latest_listings: latest snapshot per listing + lat/lng/zip/property_type
--   (drives the map: address, city, zip, latitude, longitude, price,
--    days_on_market, price_drop_pct, motivation_score, snapshot_date)
-- vw_zip_price_drop_30d: avg(price_drop_pct) per zip per snapshot_date,
--   last 30 days (drives the trend line)
```

## Pacing / robots rules (scrape stage)

- Targets only robots-allowed zillow.com paths: city search pages and
  `/homedetails/…`. Never `/api/`, `/graphql/`, `/search/HDPMapResults.htm`.
- DataImpulse rotating proxy `gw.dataimpulse.com:823`, US exit, ≥2s delay
  between requests, honor 429/Retry-After, single flight (no concurrency > 1).
- Caps per run: 5 search pages, 150 detail pages (defaults; CLI-overridable).
- CAPTCHA / PerimeterX challenge → abort run, status `failed`, report. Never bypass.
