import { NextResponse } from "next/server";
import { applyFilters, type Deal, type FilterState } from "@/lib/types";
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
  return {
    scores,
    minDom: minDomRaw == null || minDomRaw === "" ? null : Number(minDomRaw),
    zips,
    minPrice: numOrNull(u.searchParams.get("min_price")),
    maxPrice: numOrNull(u.searchParams.get("max_price")),
    type: u.searchParams.get("type"),
    limit: Math.min(Number(u.searchParams.get("limit") ?? 500) || 500, 5000),
    offset: Number(u.searchParams.get("offset") ?? 0) || 0,
  };
}
function numOrNull(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    const filtered = applyFilters(all, f);
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
  return NextResponse.json({ deals, live, count: deals.length });
}
