// WHAT:   GET /api/listing/[id]?source=zillow — the full daily snapshot series
//   for one listing, oldest first (roadmap 1.2), from vw_listing_history.
// WHY:    the /listing/[id] detail page and the SideCard's price-history panel
//   both need the per-listing time series, which /api/deals (one row per
//   listing per window) cannot answer. The DB-error branch answers 200 +
//   live:false rather than 500: the view is granted by a migration that may
//   land after this deploy, so "history unavailable" is an expected state and
//   the detail view must degrade, not break.
// INPUTS: params.id (validated against LISTING_ID), query param `source`
//   (default "zillow"), DATABASE_URL via lib/db/connection.
// OUTPUTS: ListingHistoryResponse JSON; 400 JSON {error} for a malformed id.
// CALLERS: hooks/useListingHistory (components/listings/PriceHistoryBlock).
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/connection";
import { LISTING_HISTORY_QUERY } from "@/lib/db/queries";
import type { ListingHistoryPoint, ListingHistoryResponse } from "@/lib/api-types";

// Zillow listing ids are 13-digit numeric strings, but the schema keys on
// (source, listing_id) and other sources use hashes/slugs. Accept a
// conservative URL-safe charset rather than guessing per source; anything
// outside it is a malformed request, not a missing listing.
// Verified by: /api/listing/[id] id validation — 400 outside [A-Za-z0-9_-],
//   or over 64 chars.
const LISTING_ID = /^[A-Za-z0-9_-]+$/;

// GET /api/listing/[id]?source=zillow → the full daily snapshot series for one
// listing, oldest first (roadmap 1.2). Next 15 route handlers are dynamic by
// default and the existing routes export no `dynamic`, so neither do we.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = new URL(req.url).searchParams.get("source") || "zillow";

  if (!id || id.length > 64 || !LISTING_ID.test(id)) {
    return NextResponse.json({ error: "invalid listing id" }, { status: 400 });
  }

  try {
    const sql = getSql();
    const rows = (await sql(LISTING_HISTORY_QUERY, [source, id])) as ListingHistoryPoint[];
    const body: ListingHistoryResponse = {
      listing_id: id,
      source,
      history: rows,
      latest_snapshot_date: rows.length > 0 ? rows[rows.length - 1].snapshot_date : null,
      live: true,
    };
    return NextResponse.json(body);
  } catch (err) {
    // Deliberate 200, not 500. vw_listing_history is granted by a migration
    // that may not have been applied when this deploy lands, so a DB error here
    // is an expected state, not a fault: the panel degrades to "history
    // unavailable" instead of the detail view (and the map that opens it)
    // breaking before the view grant exists.
    // Verified by: NOTHING (gap) — nothing replays the missing-view-grant DB
    //   error to assert 200 + live:false instead of 500.
    console.warn(`listing history unavailable for ${source}/${id}:`, err);
    const body: ListingHistoryResponse = {
      listing_id: id,
      source,
      history: [],
      latest_snapshot_date: null,
      live: false,
      unavailable: true,
    };
    return NextResponse.json(body);
  }
}
