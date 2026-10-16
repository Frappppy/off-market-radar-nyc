// Frozen CSV fallback — server-only. Bundled demo sample so the site stays
// useful when Neon sleeps (free-tier cold start) or DATABASE_URL is unset.
// Source: jobs/smoke-scrape-20261015-084632/cleaned/listings_2026-10-15.csv
// (82 live-proxy records), copied to public/data/listings_sample.csv.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Deal, MotivationScore, ZipTrend } from "./types";

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

const num = (v: string): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
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
    if (!["High", "Medium", "Low"].includes(score)) continue;
    deals.push({
      source: c[idx("source")] || "zillow",
      listing_id: c[idx("listing_id")],
      address: str(c[idx("address_raw")]),
      city: str(c[idx("city")]),
      zip: str(c[idx("zip")]),
      latitude: num(c[idx("latitude")]),
      longitude: num(c[idx("longitude")]),
      property_type: str(c[idx("property_type")]),
      price: num(c[idx("price_current")]),
      days_on_market: num(c[idx("days_on_market")]) as number | null,
      price_per_sqft: num(c[idx("price_per_sqft")]),
      price_drop_pct: num(c[idx("price_drop_pct")]),
      motivation_score: score,
      motivation_reason: str(c[idx("motivation_reason")]),
      snapshot_date: c[idx("snapshot_date")] || "",
      url: str(c[idx("url")]),
    });
  }
  cache = deals;
  return deals;
}

// Single-snapshot sample → one trend point per zip (demo only; live Neon
// accumulates the real 30-day series via vw_zip_price_drop_30d).
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
