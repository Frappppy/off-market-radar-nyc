// WHAT:   GET /api/listing/[id]?source=zillow — one listing's CURRENT row plus
//   its full daily snapshot series, oldest first (roadmap 1.2), from
//   vw_latest_listings and vw_listing_history.
// WHY:    the /listing/[id] detail page and the SideCard's price-history panel
//   both need the per-listing time series, which /api/deals (one row per
//   listing per window) cannot answer. Every failure branch answers 200 — with
//   `unavailable` when the series could not be read and `live:false` when the
//   row could not: the history view is granted by a migration that may land
//   after this deploy, so "history unavailable" is an expected state and the
//   detail view must degrade, not break.
//   The row is served from here too because the page used to obtain it by
//   asking /api/deals for the ENTIRE cohort (limit=5000, window_days=3650) and
//   scanning for its own id — every property page transferred the whole
//   database to find one listing.
// INPUTS: params.id (validated against LISTING_ID), query param `source`
//   (default "zillow"), DATABASE_URL via lib/db/connection.
// OUTPUTS: ListingHistoryResponse JSON — history + `unavailable` for the series
//   half, deal + `live` + dataset_latest_snapshot_date for the row half, plus
//   latest_snapshot_date; 400 JSON {error} for a malformed id.
// CALLERS: hooks/useListingHistory (components/listings/PriceHistoryBlock) and
//   app/listing/[id]/page.tsx.
// Verified by: /api/listing/[id] unavailable invariant + LISTING_DETAIL_QUERY
//   source preference (both at their own blocks below).
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/connection";
import { LISTING_DETAIL_QUERY, LISTING_HISTORY_QUERY } from "@/lib/db/queries";
import { loadFallbackDeals } from "@/lib/fallback";
import { maxSnapshotDate } from "@/lib/dates";
import type { Deal, ListingHistoryPoint, ListingHistoryResponse } from "@/lib/api-types";

// Zillow listing ids are 13-digit numeric strings, but the schema keys on
// (source, listing_id) and other sources use hashes/slugs. Accept a
// conservative URL-safe charset rather than guessing per source; anything
// outside it is a malformed request, not a missing listing.
// Verified by: /api/listing/[id] id validation — 400 outside [A-Za-z0-9_-],
//   or over 64 chars.
const LISTING_ID = /^[A-Za-z0-9_-]+$/;

// The detail row is a Deal plus the dataset-wide newest snapshot the page ages
// "last seen" against — one extra scalar on the same round trip.
type DetailRow = Deal & { dataset_latest_snapshot_date: string | null };

// GET /api/listing/[id]?source=zillow → one listing's row + its daily series.
// Next 15 route handlers are dynamic by default and the existing routes export
// no `dynamic`, so neither do we.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = new URL(req.url).searchParams.get("source") || "zillow";

  if (!id || id.length > 64 || !LISTING_ID.test(id)) {
    return NextResponse.json({ error: "invalid listing id" }, { status: 400 });
  }

  // Two statements keyed on the same (source, id), settled INDEPENDENTLY:
  // the mutable row from vw_latest_listings (granted to the read-only role by
  // Tier 1.0) and the series from vw_listing_history (granted by the Tier 1.2
  // migration, which may not be applied when this deploys). One round trip
  // failing must not cost the reader the other — a Promise.all here would drop
  // the address/price row just because the history view is not readable yet,
  // which is exactly the degrade-don't-break case the sample fallback below
  // exists for. getSql() itself throws when DATABASE_URL is missing/invalid,
  // so the factory call is inside the same protection: every failure mode ends
  // up as a rejected half, never as a 500.
  // Verified by: NOTHING (gap) — no key runs this route without DATABASE_URL,
  //   or with vw_listing_history ungranted but vw_latest_listings readable.
  let sql: ReturnType<typeof getSql> | null = null;
  try {
    sql = getSql();
  } catch (err) {
    console.warn(`listing queries skipped (no Neon connection) for ${source}/${id}:`, err);
  }
  const noConnection = (): PromiseSettledResult<never> => ({
    status: "rejected",
    reason: "no Neon connection",
  });
  const settled = sql
    ? await Promise.allSettled([
        // The neon driver's own promise type is a superset shape (it also
        // carries a transaction flag); `unknown` is the honest bridge to the
        // row type the SQL actually returns.
        sql(LISTING_HISTORY_QUERY, [source, id]) as unknown as Promise<ListingHistoryPoint[]>,
        sql(LISTING_DETAIL_QUERY, [source, id]) as unknown as Promise<DetailRow[]>,
      ])
    : ([noConnection(), noConnection()] as [
        PromiseSettledResult<ListingHistoryPoint[]>,
        PromiseSettledResult<DetailRow[]>,
      ]);
  const [historyRes, detailRes] = settled;

  // ---- the row: live view → bundled sample → genuinely absent ----
  let deal: Deal | null = null;
  let datasetLatest: string | null = null;
  // Each half remembers which dataset it answered from, so `live` describes
  // this response rather than assuming both halves came from Neon.
  let rowLive = true;
  if (detailRes.status === "fulfilled") {
    // `ORDER BY (source = $1) DESC LIMIT 1` returns the requested source's row
    // first and any other source holding the id second — the same two-step
    // search the page used to do in memory over the whole cohort.
    // Verified by: /api/listing/[id] LISTING_DETAIL source preference — the
    //   ORDER BY in LISTING_DETAIL_QUERY is the whole rule.
    const found = detailRes.value[0] ?? null;
    if (found) {
      const { dataset_latest_snapshot_date, ...row } = found;
      deal = row as Deal;
      datasetLatest = dataset_latest_snapshot_date;
    }
  } else {
    console.warn(`listing row unavailable from Neon for ${source}/${id}:`, detailRes.reason);
    rowLive = false;
    const sample = await loadFallbackDeals();
    deal =
      sample.find((d) => d.listing_id === id && d.source === source) ??
      sample.find((d) => d.listing_id === id) ??
      null;
    datasetLatest = maxSnapshotDate(sample);
  }

  // ---- the series: live view → nothing (unavailable) ----
  let history: ListingHistoryPoint[] = [];
  let seriesLive = true;
  if (historyRes.status === "fulfilled") {
    history = historyRes.value;
  } else {
    // Deliberate 200, not 500 — the expected pre-migration state: the panel
    // degrades to "history unavailable" instead of the detail view (and the map
    // that opens it) breaking before the view grant exists.
    // Verified by: /api/listing/[id] unavailable invariant — the flag is set
    //   exactly here, and only here.
    console.warn(`listing history unavailable for ${source}/${id}:`, historyRes.reason);
    seriesLive = false;
  }

  // `unavailable` means "the history series could not be read", which is not the
  // same as "read fine and this listing has one snapshot" — an empty series from
  // a healthy view is data, not a missing capability, so only the rejected half
  // sets it.
  const unavailable = !seriesLive;
  return NextResponse.json({
    listing_id: id,
    source,
    history,
    latest_snapshot_date: history.length > 0 ? history[history.length - 1].snapshot_date : null,
    // `live` describes the ROW — the only thing the page's provenance pill
    // labels ("these numbers come from the bundled sample"). It deliberately
    // does NOT AND in `seriesLive`: the pre-migration state this route exists
    // for is exactly "row from live SQL, series not granted yet", and calling
    // that frozen would tell a reader the address and price came from a sample
    // when they did not. The series carries its own flag in `unavailable`.
    live: rowLive,
    ...(unavailable ? { unavailable: true } : {}),
    deal,
    dataset_latest_snapshot_date: datasetLatest,
  } satisfies ListingHistoryResponse);
}
