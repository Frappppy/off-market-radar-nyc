# Website Plan — Project 1: Off-Market Real Estate Deal Finder
> Status: V1 COMPLETE AND DEPLOYED (owner sign-off 2026-10-15; deployed
> 2026-10-16) — https://off-market-radar-nyc.vercel.app
> Vercel project `frappppy/off-market-radar-nyc`, root `site/`. Production
> `DATABASE_URL` is the read-only Neon role `offmarket_reader`
> (see `sql/vercel_readonly_role.sql`): SELECT on the two dashboard views +
> pipeline_runs only; base tables denied. Stored as a Vercel Secret.
> Live path verified end to end: `sql/schema.sql` + `dashboard/views.sql`
> applied, 82 records loaded through the real `python -m src.store` loader;
> `/api/meta` returns `live:true` (82 tracked / 2 High); `/api/deals`,
> `/api/zips`, CSV export and all 4 routes return 200 on production, public
> without auth.
> (Those counts are the V1 sign-off snapshot; current live figures are in
> README § Verification status.)
> Remaining: `recharts` 2.x is deprecated upstream (bump to v3 later);
> V2 = Softr portal + alerts.
> Decision: Vercel Hobby (free) for presentation layer. GitHub = code, Neon = data, Vercel = presentation.

## 1. Concept

- **One link to rule them all:** client opens `https://<project>.vercel.app`, uses the app, downloads filtered CSV. No installs, no Power BI license, no DB password.
- Two links total to send:
  1. Live demo (Vercel) — for use.
  2. GitHub repo — for audit (code, tests, Actions runs, manifests/logs).
- **Power BI stays** as the analyst artifact (in `dashboard/` + screenshots). It is NOT embedded in the site. Link to it from the site footer.
- Optional Softr portal idea is parked. If built later, it reads the same Neon views with native Softr blocks, not a Power BI iframe.

## 2. How a client interacts (user journey)

1. Opens link → sees freshness strip: "Data as of Oct 15 • 412 tracked • 38 High • source Zillow NYC".
2. Map Explorer (home): clustered pins, color = motivation (High=red, Medium=yellow, Low=grey).
3. Drags filters: Motivation=High only, DOM slider >60, price range, type, ZIP multi-select. Map + KPIs + table all update together. Counter shows "38 of 412 shown".
4. Clicks pin → side card: address, price + drop badge, DOM badge, $/sqft, beds/baths/type, mini price-history sparkline, motivation reason, [View on Zillow ↗] [Add to shortlist].
5. Checks Trends: 30-day avg-drop-by-zip lines, High-by-zip bar, DOM histogram.
6. Goes to Data → same filtered rows in sortable table (25/page) → [Download exactly these N rows as CSV] → drops into CRM/driving app.
7. Reads Methodology footer: formula, pipeline diagram, robots/compliance note, "demo sample — full details on Zillow".

Shortlist V1 = browser localStorage (no login). V2 = login + saved searches + email alerts (not promised in V1).

## 3. Site map (4 routes)

- `/` Overview — hero ("38 motivated sellers in NYC this week"), 4 KPI cards (Tracked, % High, Avg drop, Avg DOM), 3 written insights (the analysis layer), mini map preview → CTA "Explore the map".
- `/map` Explorer — full-screen map + sidebar filters (core; clients live here).
- `/trends` Markets — 30-day lines + zip rankings.
- `/data` Download — full table + CSV export of currently filtered rows + run metadata (snapshot date, source).
- Footer (all pages) — How it works, Motivation formula, compliance note, repo + Power BI links.

Mobile: filters collapse into drawer, map on top, table becomes cards (responsive CSS requirement).

## 4. Filter cascade (unified — one filter set drives charts + table + download)

- Source: [Zillow ▾] (only enabled; others greyed "soon")
- Country: [USA ▾] (greyed others)
- City: [New York ▾] (greyed others)
- ZIP: multi-select (live from data)
- Price: slider ($300k–$2M default range from data)
- Type: house / condo / co-op / townhouse / multi-family / land / other
- DOM: slider, default >60
- Score: ☑ High ☑ Medium ☐ Low
- [Reset] + "N of M shown"

Future selectors (Italy/Milan etc.) are NOT data — each country needs its own portal source (e.g. Immobiliare.it/Idealista) + own legal check. Schema already has `source` column; new city = new scraper config, not new site code. Say "multi-city ready", never "global".

## 5. Architecture (Vercel Hobby, $0)

```
GitHub Actions (daily 10:00 UTC, free)
  → scrape → clean → Neon Postgres (views: vw_latest_listings, vw_zip_price_drop_30d, pipeline_runs)
                                                        ↓ read-only via HTTP driver
Vercel Hobby (Next.js App Router, free *.vercel.app)
  → /api/deals, /api/zips, /api/meta → Map (MapLibre+OSM) + Charts (Recharts) + Table + CSV
```

- Scraper NEVER runs on page load. Site reads yesterday's snapshot only.
- Neon access via serverless HTTP driver (`@neondatabase/serverless`) — required on Vercel serverless (classic pg pools die). One query per load.
- Env vars (DATABASE_URL read-only role ideally) set in Vercel dashboard, never in code.
- Frozen CSV fallback bundled for demo resilience (if Neon sleeps → show sample + "live waking" note).
- Repo layout when built:
  ```
  <this project folder = the repo root>
    .github/workflows/  (daily pipeline cron)
    src/scrape|clean|store/  (unchanged robot)
    sql/schema.sql, dashboard/ (unchanged analyst artifact)
    site/  (Vercel app root; the Vercel project points here)
      app/(routes)/ lib/db.ts (formerly — since split into lib/db/)  app/api/*/
      components/Map.client.tsx (formerly — shipped as components/listings/DealMap.tsx) ...
  ```

## 6. API shapes (from existing views — no new SQL needed)

- `GET /api/meta` ← `pipeline_runs` latest success: { snapshot_date, records_loaded, source, run_id } → header strip.
- `GET /api/deals?score=High&min_dom=60&zip=11226,...&min_price=&max_price=&type=` ← `vw_latest_listings` filtered, paginated (limit 500 map / 25 table). Fields: source, listing_id, address, city, zip, latitude, longitude, property_type, price, days_on_market, price_per_sqft, price_drop_pct, motivation_score, motivation_reason, snapshot_date, url.
- `GET /api/zips` ← `vw_zip_price_drop_30d`: [{ zip, snapshot_date, avg_price_drop_pct, listing_count }] → trend lines + bar.
- CSV export = same query as table, `Content-Disposition: attachment`, max ~5k rows.

Perf: cap map to latest snapshot only, paginate table, cluster pins client-side (supercluster). ~400 pins = instant.

## 7. Look & feel

- Zillow-meets-terminal, clean light theme. One accent palette shared everywhere: High=#d62728 red, Medium=#e6a817 yellow, Low=#9aa0a6 grey.
- Sticky header: logo "OFF-MARKET RADAR · NYC ▾" + nav Overview/Map/Trends/Data + freshness strip.
- MapLibre GL + OpenStreetMap tiles (free, no token). Cluster bubbles with counts; click cluster → zoom; click pin → side card (not new page).
- Charts: Recharts line (avg drop % by top-6 zips, 30d), bar (High count by zip), histogram (DOM). Plain dates on X axis.
- Table: sortable, paginated, row click → same side card. Export button above table.
- Trust footer: pipeline diagram (ASCII in README), formula, robots note ("allowed paths only, CAPTCHA = abort"), "Demo sample — full details on Zillow ↗", "Production would use licensed MLS feed" line.

## 8. Hosting + domain ($0 total)

| Piece | Free home | URL |
|---|---|---|
| Showcase + app | Vercel Hobby | `*.vercel.app`, auto-SSL — deploys by CLI from the repo root (`vercel deploy --prod --yes --project off-market-radar-nyc`); ~~no Git integration, so a push does not deploy~~ (README § Deploy mechanics) |
| Alt static | GitHub/Cloudflare Pages | `*.github.io` |
| DB | Neon Free | (paused when idle — first query slow; note it on site) |
| Robot | GitHub Actions Free | daily cron ~450 min/mo, safe |
| Dashboard share | Power BI Publish-to-web (public demo only) | link, never for real client data |

> **Correction (2026-10-17).** The "no Git integration, so a push does not deploy"
> clause in the first row is superseded. The Vercel GitHub App is installed on
> `Frappppy/off-market-radar-nyc` and the project is connected:
> `GET /v9/projects/prj_lZtIBrfxq0TehcMulRyjF4ijQifY` returns `link.type=github`,
> `link.org=Frappppy`, `link.repo=off-market-radar-nyc`, `link.productionBranch=main`,
> `rootDirectory=site`. A `git push` to `main` therefore deploys production with no CLI
> step: pushing empty commit `3495fea` (2026-10-17 08:14:39Z) created
> `dpl_9wcKJJhChPefgAfgKrXYa4Xwt478` at 08:14:46Z — `READY`, `target=production`,
> `source=git` (a CLI deploy reports `source=cli`) — and moved the production alias to
> `off-market-radar-80u84hga7-frappppy.vercel.app`. The CLI command in the row still
> works and is how the earlier deploys shipped; it is no longer the only route. Full
> detail: README § Deploy mechanics.

- No good free custom domains anymore (Freenom dead). Use `*.vercel.app` / `*.github.io` — trusted, professional for portfolio.
- Later ($10–12/yr once): buy `yourname.dev/.me` on Cloudflare Registrar, point at Vercel in 3 clicks. Optional only.
- Hobby catches: cold start 1–2s, 100 GB/mo bandwidth (app uses ~1–2), env vars in dashboard. Streamlit/Render sleep harder; Vercel + Cloudflare Pages don't.
- Never share: DATABASE_URL write creds, DataImpulse creds. Visitors get read-only demo; secrets stay in Vercel env + GitHub Secrets.

## 9. Verification story (client self-serve — "just give them a link")

- Header freshness proves recency. Methodology proves method. CSV download proves data is real (spot-check 2–3 addresses on Zillow). Footer repo link → Actions runs (green checks, daily), `jobs/<run_id>/` manifests + process_log.md, 142 tests.
- Audiences: wholesaler (uses demo), hiring manager (reads case study + screenshots), engineer (audits repo: tests, contract, no secrets, idempotent SQL, pacing/robots).
- Send message template: "Live demo tracking motivated sellers in NYC this week: [vercel link]. Drag DOM above 60, keep High only — pins are the call list. CSV export is the exact filtered view. Method + code: [repo link]. Refreshes daily; timestamp in header."

## 10. Power BI vs website (settled)

- Dashboard IS analysis (descriptive). Written takeaways = interpretive layer. Portfolio needs both.
- Power BI report = 5 pages normal: Overview/KPIs, Map, Price analysis (treemap/bar/$/sqft), Motivation/DOM (mix, histogram, scatter), Data+Export.
- Don't embed Power BI in Vercel/Softr via iframe for clients (public-link exposure, dual-filter confusion, Pro/Premium licensing for private embed). Keep Power BI as repo artifact + screenshots + optional "Analyst deep-dive" link.
- Dashboard (decide where to look) + CSV download (go work it) coexist: same filters, two outputs. Standard data-product pattern.

## 11. Build order (when approved)

1. ✅ Relocate repo (done 2026-10-16) — this folder is now the repo root,
   published as `off-market-radar-nyc`; the pipeline workflow lives in
   `.github/workflows/` inside it. The workspace-level
   `.github/workflows/daily_pipeline.yml` is superseded by that copy.
2. ✅ Re-run pytest from the new root; refresh requirements.txt; finalize README status table.
3. ✅ Scaffold `site/` (Next.js + MapLibre + Recharts), wire `/api/meta|deals|zips` to Neon views, bundle frozen CSV fallback.
4. ✅ Build routes: `/`, `/map`, `/trends`, `/data` + shared filter state + side card + export.
5. ✅ Vercel project (root `site/`), read-only `DATABASE_URL`, deployed at
   <https://off-market-radar-nyc.vercel.app>; cold start + production endpoints verified.
   Mobile: header fixed; the collapsed-filters/map-first drawer on `/map` is still outstanding.
6. ⏳ Case-study copy for homepage + LinkedIn post. Loom walkthrough (2 min) as backup if live app sleeps during interview.

## 12. Open decisions (answered by owner 2026-10-15 — locked for V1)

- [x] Landing: **map-first** (recommended for wholesalers).
- [x] Day-one data: **live Neon + frozen fallback**.
- [x] URL name: **decide at deploy time** (check availability at creation).
- [x] Softr portal: **parked as V2 roadmap line** on site.
- [x] Alerts (email/SMS): **explicitly V2**, not promised in V1.
