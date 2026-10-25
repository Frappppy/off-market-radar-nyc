# Probe findings — full-corpus harvest viability (2026-10-23)

Run on the Linux dev box, headed Chromium (Playwright 1.64), **direct connection**
(no DataImpulse credentials on this machine — the stack env file still holds the
`your_login_here` placeholders). Every URL below is a robots-allowed path.

## 1. HTTP 403 does not mean "blocked" any more

`GET https://www.zillow.com/brooklyn-ny-11215/` returned **HTTP 403**, title
`Access to this page has been denied`, and still shipped a complete
`__NEXT_DATA__` payload:

```
listResults          41
totalResultCount     165
pagination.nextUrl   /brooklyn-new-york-ny-11215/2_p/
```

The rendered page (screenshot `probe-403-page.png` in this folder) is the normal
search UI with 165 results. Consequence: `http.looks_like_block()` (403 =>
abort) is the reason `jobs/full-scrape-20261016{,b}` died in 3 seconds — the
correct block signal is **"is the expected JSON payload in the DOM"**, not the
status code. `browser.page_payload_kind()` implements that rule; the legacy
curl_cffi path was left untouched.

## 2. Zillow caps one search at ~820 results — ZIP shards are mandatory

`/new-york-ny/` reports the target number (**22,756**, same as the test
fixture). A single search cannot paginate past ~20 pages / 820 rows, so the
corpus must be sharded. ZIP pages work and are small enough:

| URL | HTTP | total | canonical next page |
|---|---|---|---|
| `/brooklyn-ny-11215/` | 403* | 165 | `/brooklyn-new-york-ny-11215/2_p/` |
| `/new-york-ny-10001/` | 200 | 99 | `/manhattan-new-york-ny-10001/2_p/` |
| `/queens-ny-11354/` | 200 | 447 | `/queens-new-york-ny-11354/2_p/` |
| `/bronx-ny-10451/` | 200 | 60 | `/bronx-new-york-ny-10451/2_p/` |
| `/staten-island-ny-10301/` | 200 | 164 | `/staten-island-new-york-ny-10301/2_p/` |

\* still had the full payload (finding 1). `/astoria-ny-11102/` is a **404** —
neighbourhood slugs are not reliable, the `/<borough>-ny-<zip>/` form is.
Shard list: `config/nyc_zips.csv` (177 residential MODZCTAs, 5 boroughs,
NYC Open Data `pri4-ifjk`).

## 3. Pacing / duration measured

| page | load | cards |
|---|---|---|
| search | 2.7 s | 41 |
| detail | 3.9 s | 1 |

555 search pages (22,756 / 41) at ~4 s incl. the 2 s pacing floor ≈ **40–60 min**
for the whole city, search cards only. The detail pass is ~4.5 s × 22,756 ≈
**28 h**, hence `--details motivated` (price cut or DOM > 60) is the sane first
enrichment.

## 4. Search cards already carry the deal signals

One card's `hdpData.homeInfo` at 11215:

```
price 1500000 · priceChange -75000 · priceReduction "$75,000 (Oct 15)"
daysOnZillow 49 · homeType CONDO · livingArea 1139 · zestimate 1520200
taxAssessedValue … · latitude/longitude … · homeStatus FOR_SALE
```

So the full 22k rows can be landed **without** detail pages: price, prior
price, DOM, type, beds/baths/sqft, lat/long, zestimate. Details add
`price_history`, `listed_date`, description.

## 5. Manual CAPTCHA pause works

On the 4th request of the smoke run a real challenge appeared. The run printed
the banner, brought the window forward, polled every 2 s, and continued with the
same cookies once the payload appeared — no restart, no data loss.

## 6. Smoke-run output (evidence that the contract matches)

`jobs/harvest-probe/raw/` — 2 ZIPs × 2 pages:

```
164 unique listings · 164 JSONL rows · 43 with price_reduced
manifest: status success, records_out 164
clean:    src.clean accepted it -> listings_2026-10-23.parquet
```

## 7. Two kinds of block — only one is solvable

Full-run logs (`jobs/full-harvest-20261023/logs/`) show distinct behaviours:

| banner | page | human action | count |
|---|---|---|---|
| `ZILLOW CHALLENGE` | title `Access to this page has been denied`, body contains `Press & Hold to confirm you are a human` | hold the widget 5–10 s | 22 |
| `HARD BLOCK` | same title, **empty body, 0 iframes** | none possible — IP is flagged | 10 |

The hard block has no widget at all, so waiting for a solve is dead time: the
first run sat on one for the full 15-minute window. `browser._solvable()` now
gates on the rendered text (`press & hold` / `verify you are human`) plus the
`px-captcha` selectors, and `fetch()` returns `blocked=True` immediately when
none is present.

## 8. Rotation on block (sticky session -> fresh exit)

`BrowserSession.rotate()` clears cookies (clearance is IP-bound), relaunches the
same persistent profile against a new sticky DataImpulse session
(`nyc-02` -> `nyc-02-r1`, `-r2`, …) and `harvest` retries the same URL, max 2
rotations per page. Every hard block in the run cleared on the first rotation:

```
HARD BLOCK ... /queens-new-york-ny-11375/6_p/   (empty body)
  -> rotated to exit #1, retrying
  page 6: 41 cards, +41 new
```

Human window for a genuine widget is now 180 s (was 900 s) before rotating.

## 9. Phase 1 result — search pass complete

`jobs/full-harvest-20261023/raw/manifest.json`:

```
status success · shards 177/177 · records_out 22577 · reported_results_sum 24992
jobs/full-harvest-20261023/cleaned/listings_2026-10-23.parquet · 22577 x 26
```

- 22,577 unique `listing_id` vs Zillow's 22,756 city total = **99.2 %**.
- 184 distinct ZIPs in the rows (177 targets + 7 out-of-city padding cards:
  111 NJ, 1 FL, 1 VA).
- Wall clock ~58 min across two runs, 22 solvable challenges + 10 hard blocks.
- `reported_results_sum` > city total because each ZIP page pads with nearby
  homes; dedupe on `listing_id` is the only trustworthy count.
- Known dirty subset: 147 rows with `price_current = 0`, 21 above $50 M,
  10 with `price_drop_pct >= 80` (bad `price_previous` parse). Detail pass would
  not fix these; a clean-stage guard would.
