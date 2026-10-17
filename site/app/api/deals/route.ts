import { NextResponse } from "next/server";
import { applyFilters, type Deal, type DealsResponse, type FilterState } from "@/lib/types";
import { buildDealsQuery, getSql } from "@/lib/db";
import { loadFallbackDeals } from "@/lib/fallback";

function parse(req: Request) {
  const u = new URL(req.url);
  const scores = (u.searchParams.get("score") ?? "High,Medium")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const minDomRaw = u.searchParams.get("min_dom");
  const zips = (u.searchParams.get("zip") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const windowRaw = numOrNull(u.searchParams.get("window_days"));
  return {
    scores,
    // numOrNull, NOT bare Number(): `min_dom=abc` used to yield NaN, which
    // buildDealsQuery pushed into SQL (`days_on_market >= 'NaN'`) -> integer
    // cast error -> the catch below silently served the FROZEN SAMPLE for a
    // mere typo. Absent/empty -> null (no floor), unparseable -> null, so a
    // mistyped link can only ever widen, never swap the dataset. min_price and
    // window_days already went through this guard; min_dom was the odd one out.
    minDom: numOrNull(minDomRaw),
    zips,
    minPrice: numOrNull(u.searchParams.get("min_price")),
    maxPrice: numOrNull(u.searchParams.get("max_price")),
    type: u.searchParams.get("type"),
    // Recency guard (roadmap 1.1). DEFAULT 1, not 0: a 1-day window returns
    // the newest snapshot PLUS anything carried over from the run before it,
    // so a listing that dropped out of the latest run is still visible and its
    // "last seen yesterday / N days ago" label means something. The old `0`
    // default pinned exactly the newest snapshot, which made every returned
    // row tautologically current and the per-listing freshness label
    // structurally incapable of saying anything but "today".
    // An explicit `window_days=0` still means "newest snapshot only", and
    // buildDealsQuery clamps again, so anything negative/absurd degrades to a
    // safe value instead of reaching SQL.
    windowDays: windowRaw == null ? 1 : Math.max(0, Math.floor(windowRaw)),
    limit: Math.min(Number(u.searchParams.get("limit") ?? 500) || 500, 5000),
    offset: Number(u.searchParams.get("offset") ?? 0) || 0,
  };
}
function numOrNull(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Newest snapshot_date across the returned rows — no extra query needed, and
// it is the same value the recency guard anchored on. YYYY-MM-DD sorts
// lexicographically, so a string max is exact.
function maxSnapshotDate(deals: Deal[]): string | null {
  let max = "";
  for (const d of deals) {
    if (d.snapshot_date && d.snapshot_date > max) max = d.snapshot_date;
  }
  return max || null;
}

// CSV export uses the same query path (?format=csv, up to 5k rows) so the
// download is exactly the filtered view — see websiteplan §6.
export async function GET(req: Request) {
  const q = parse(req);
  const u = new URL(req.url);
  const wantCsv = u.searchParams.get("format") === "csv";

  let deals: Deal[];
  let live = true;
  try {
    const sql = getSql();
    const { text, params } = buildDealsQuery({
      scores: q.scores,
      minDom: q.minDom,
      zips: q.zips,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      type: q.type,
      windowDays: q.windowDays,
      limit: wantCsv ? 5000 : q.limit,
      offset: wantCsv ? 0 : q.offset,
    });
    deals = (await sql(text, params)) as Deal[];
  } catch {
    live = false;
    const all = await loadFallbackDeals();
    const f: FilterState = {
      score: (q.scores.length > 0 ? q.scores : ["High", "Medium", "Low"]) as FilterState["score"],
      minDom: q.minDom ?? 0,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      type: q.type,
      zips: q.zips,
    };
    // The frozen sample is a single pre-guard snapshot per listing. The live
    // path anchors on max(snapshot_date); apply the same rule to the sample,
    // otherwise window_days=0 would return whatever the sample happens to hold
    // (rows from an older date included) while the response still reports 0 —
    // the same silent-stale-cohort bug the recency guard exists to prevent.
    // window_days >= 1 (the /api/deals default) takes the whole sample, which
    // for a single-snapshot CSV is every row, so every fallback listing
    // honestly reports "last seen today".
    const newest = all.reduce((m, d) => (d.snapshot_date && d.snapshot_date > m ? d.snapshot_date : m), "");
    const cohort = q.windowDays <= 0 && newest ? all.filter((d) => d.snapshot_date === newest) : all;
    const filtered = applyFilters(cohort, f);
    deals = wantCsv ? filtered.slice(0, 5000) : filtered.slice(q.offset, q.offset + q.limit);
  }

  if (wantCsv) {
    const cols = [
      "source", "listing_id", "address", "city", "zip", "latitude", "longitude",
      "property_type", "price", "days_on_market", "price_per_sqft",
      "price_drop_pct", "motivation_score", "motivation_reason",
      "snapshot_date", "url",
    ];
    const esc = (v: unknown) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(",")]
      .concat(deals.map((d) => cols.map((c) => esc((d as unknown as Record<string, unknown>)[c])).join(",")))
      .join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deals_${deals.length}.csv"`,
      },
    });
  }
  const body: DealsResponse = {
    deals,
    live,
    count: deals.length,
    window_days: q.windowDays,
    latest_snapshot_date: maxSnapshotDate(deals),
  };
  return NextResponse.json(body);
}
