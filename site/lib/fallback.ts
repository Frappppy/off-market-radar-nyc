// WHAT:   the frozen CSV fallback — parses public/data/listings_sample.csv
//   into Deal[] (loadFallbackDeals) and derives one-point-per-ZIP trends from
//   it (loadFallbackTrends). Server-only.
// WHY:    Neon sleeps on the free tier and DATABASE_URL may be unset; without
//   this the whole site would 500 instead of serving a clearly-labelled frozen
//   sample. Source: jobs/smoke-scrape-20261015-084632/cleaned/
//   listings_2026-10-15.csv (82 live-proxy records), copied to public/data/.
//   SCOPE: this file is ONLY the offline fallback. The live site reads Neon and
//   currently tracks ~22.3k listings; the 82 rows here are a smoke-run sample
//   kept small on purpose so the fallback bundle stays tiny and obviously not
//   the real dataset. Do not read it as the site's coverage figure.
//   The result is cached in-module: every route that falls back must see the
//   SAME rows, and the file is read once per process.
// Verified by: NOTHING (gap) — nothing compares two routes' fallback rows.
// INPUTS: public/data/listings_sample.csv (header row + RFC-4180-ish lines).
// OUTPUTS: Promise<Deal[]> (memoised) and Promise<ZipTrend[]> (derived).
// CALLERS: app/api/{deals,health,meta,zips}/route.ts and app/sitemap.ts.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNum } from "./format";
import { SCORES } from "./scores";
import type { Deal, MotivationScore, ZipTrend } from "./api-types";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

const str = (v: string): string | null => (v == null || v === "" ? null : v);

let cache: Deal[] | null = null;

export async function loadFallbackDeals(): Promise<Deal[]> {
  if (cache) return cache;
  const p = join(process.cwd(), "public", "data", "listings_sample.csv");
  const raw = await readFile(p, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const head = splitCsvLine(lines[0]);
  const idx = (name: string) => head.indexOf(name);
  const deals: Deal[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const score = c[idx("motivation_score")] as MotivationScore;
    // Verified by: TS — SCORES.includes drops unknown scores before they
    //   reach the Deal[], so the MotivationScore cast is only a narrowing.
    if (!SCORES.includes(score)) continue;
    deals.push({
      source: c[idx("source")] || "zillow",
      listing_id: c[idx("listing_id")],
      address: str(c[idx("address_raw")]),
      city: str(c[idx("city")]),
      zip: str(c[idx("zip")]),
      latitude: parseNum(c[idx("latitude")]),
      longitude: parseNum(c[idx("longitude")]),
      property_type: str(c[idx("property_type")]),
      price: parseNum(c[idx("price_current")]),
      days_on_market: parseNum(c[idx("days_on_market")]) as number | null,
      price_per_sqft: parseNum(c[idx("price_per_sqft")]),
      price_drop_pct: parseNum(c[idx("price_drop_pct")]),
      motivation_score: score,
      motivation_reason: str(c[idx("motivation_reason")]),
      snapshot_date: c[idx("snapshot_date")] || "",
      url: str(c[idx("url")]),
    });
  }
  cache = deals;
  return deals;
}

// ---- frozen CSV fallback: Deal[] + demo ZIP trends from one sample ----
// Single-snapshot sample → one trend point per zip (demo only; live Neon
// accumulates the real 30-day series via vw_zip_price_drop_30d).
// Verified by: NOTHING (gap) — the derived point-per-zip shape is unkeyed.
export async function loadFallbackTrends(): Promise<ZipTrend[]> {
  const deals = await loadFallbackDeals();
  const byZip = new Map<string, { sum: number; n: number; count: number; date: string }>();
  for (const d of deals) {
    if (!d.zip) continue;
    const e = byZip.get(d.zip) ?? { sum: 0, n: 0, count: 0, date: d.snapshot_date };
    e.count++;
    if (d.price_drop_pct != null) {
      e.sum += d.price_drop_pct;
      e.n++;
    }
    byZip.set(d.zip, e);
  }
  return [...byZip.entries()].map(([zip, e]) => ({
    zip,
    snapshot_date: e.date,
    avg_price_drop_pct: e.n > 0 ? Math.round((e.sum / e.n) * 10) / 10 : null,
    listing_count: e.count,
  }));
}
