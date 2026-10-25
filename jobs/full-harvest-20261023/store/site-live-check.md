# Site live check — after the full harvest load (2026-10-24)

Next dev server (`site/`, port 3112) pointed at the **read-only** role
(`config/vercel_reader.local.env`, gitignored), talking to Neon through
`@neondatabase/serverless`.

| endpoint | result |
|---|---|
| `/api/health` | `live: true`, run `full-harvest-20261023`, 22,317 tracked, 4 snapshot days, coverage 97.9 % |
| `/api/meta` | `live: true`, snapshot 2026-10-23, `high_count: 1844` |
| `/api/deals?scores=High` | `live: true`, real rows (e.g. 56 E 1st St 10003, $9,935,000, -25 %, 2,920 DOM) |
| `/api/zips` | trends from the DB (starts 2026-10-15, the oldest snapshot) |

The 1,844 High count matches the Parquet exactly, so the view, the loader and
the scoring agree end to end.

## Local-only gotcha (not a code defect)

On this machine Node's happy-eyeballs picks an IPv6 route to Neon and times
out (`fetch failed` / `ETIMEDOUT`) even though `curl -4` reaches the same host.
Running the dev server with

```
NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"
```

fixes it. Vercel's runtime has working IPv6, so no change is needed there.

## Least-privilege proof

Connected as `offmarket_reader`:

```
vw_latest_listings        22452
vw_zip_price_drop_30d       546
vw_listing_history        24399
pipeline_runs                 4
listings            -> permission denied (InsufficientPrivilege)
```
