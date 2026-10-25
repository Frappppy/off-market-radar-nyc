// WHAT:   GET /api/deals — parses the filter query params, builds the SQL via
//   lib/db/deals-query (or filters the frozen CSV when Neon is unreachable),
//   and answers with a DealsResponse JSON body or a CSV attachment.
// WHY:    the one request path behind every explorer cohort (map pins, /data
//   rows, /trends, the hero). Its parse() guards exist because of two live
//   incidents: `min_dom=abc` reached SQL as `>= 'NaN'` (integer cast error)
//   which the catch below answered with the FROZEN SAMPLE, and the old
//   window_days=0 default pinned only the newest snapshot so "last seen N days
//   ago" could never say anything but "today" (recency guard, roadmap 1.1).
// INPUTS: query params — score (csv), min_dom, min_price, max_price, type,
//   zip (csv), window_days, limit (clamped to [1, EXPORT_LIMIT], lib/limits.ts),
//   offset, format=csv; plus the DATABASE_URL via lib/db/connection, else
//   public/data/listings_sample.csv.
// OUTPUTS: DealsResponse JSON {deals, live, count, window_days,
//   latest_snapshot_date} or `text/csv` attachment (EXPORT_LIMIT rows max —
//   format=csv always requests the ceiling, it is not the page's limit).
// CALLERS: hooks/useDeals (every page), the CSV export link on /data.
// Verified by: /api/deals — min_dom parse guard, recency guard, limit clamp
//   (all three named at their own blocks below).
import { NextResponse } from "next/server";
import { applyFilters, type FilterState } from "@/lib/filters";
import type { Deal, DealsResponse } from "@/lib/api-types";
import { getSql } from "@/lib/db/connection";
import { buildDealsQuery } from "@/lib/db/deals-query";
import { loadFallbackDeals } from "@/lib/fallback";
import { parseNum } from "@/lib/format";
import { maxSnapshotDate } from "@/lib/dates";
import { SCORES } from "@/lib/scores";
import { EXPORT_LIMIT, PAGE_LIMIT_DEFAULT, clampLimit } from "@/lib/limits";

// ---- parse(): the query-param guards (incident-driven, see WHY above) ----
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
  const windowRaw = parseNum(u.searchParams.get("window_days"));
  return {
    scores,
    // parseNum, NOT bare Number(): `min_dom=abc` used to yield NaN, which
    // buildDealsQuery pushed into SQL (`days_on_market >= 'NaN'`) -> integer
    // cast error -> the catch below silently served the FROZEN SAMPLE for a
    // mere typo. Absent/empty -> null (no floor), unparseable -> null, so a
    // mistyped link can only ever widen, never swap the dataset. min_price and
    // window_days already went through this guard; min_dom was the odd one out.
    // Verified by: /api/deals min_dom parse guard — parseNum → null, never NaN.
    minDom: parseNum(minDomRaw),
    zips,
    minPrice: parseNum(u.searchParams.get("min_price")),
    maxPrice: parseNum(u.searchParams.get("max_price")),
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
    // Verified by: /api/deals recency guard (default 1; 0 = newest only).
    windowDays: windowRaw == null ? 1 : Math.max(0, Math.floor(windowRaw)),
    // clampLimit (lib/limits.ts) is the same named rule the SQL builder uses,
    // so a page asking for 500 and an export asking for the ceiling cannot
    // drift apart. `|| PAGE_LIMIT_DEFAULT` keeps the old meaning of limit=0 /
    // limit=abc: absent, not one row.
    // Verified by: /api/deals limit clamp — [1, EXPORT_LIMIT] via clampLimit.
    limit: clampLimit(Number(u.searchParams.get("limit") ?? PAGE_LIMIT_DEFAULT) || PAGE_LIMIT_DEFAULT),
    offset: Number(u.searchParams.get("offset") ?? 0) || 0,
  };
}

// ---- GET: live SQL path → frozen-CSV fallback → JSON or CSV answer ----
// CSV export uses the same query path (?format=csv) but takes the whole
// ceiling, not the page's limit: the table on /data shows PAGE_LIMIT_DEFAULT
// rows, the file is the full filtered cohort up to EXPORT_LIMIT. The download
// is therefore a SUPERSET of the view, never a copy of it — which is what
// app/data/export-header.tsx now says out loud.
// Verified by: NOTHING (gap) — no check compares the CSV body to the JSON view.
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
      limit: wantCsv ? EXPORT_LIMIT : q.limit,
      offset: wantCsv ? 0 : q.offset,
    });
    deals = (await sql(text, params)) as Deal[];
  } catch {
    live = false;
    const all = await loadFallbackDeals();
    const f: FilterState = {
      score: (q.scores.length > 0 ? q.scores : [...SCORES]) as FilterState["score"],
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
    // honestly reports "last seen today". maxSnapshotDate() answers "" -> null,
    // which the `newest ?` guard below reads exactly as the old `""` reduce did.
    // Verified by: /api/deals fallback recency parity (same maxSnapshotDate
    //   rule as the live path).
    const newest = maxSnapshotDate(all);
    const cohort = q.windowDays <= 0 && newest ? all.filter((d) => d.snapshot_date === newest) : all;
    const filtered = applyFilters(cohort, f);
    deals = wantCsv
      ? filtered.slice(0, EXPORT_LIMIT)
      : filtered.slice(q.offset, q.offset + q.limit);
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
