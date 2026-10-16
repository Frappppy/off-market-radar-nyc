import { NextResponse } from "next/server";
import { LISTING_HISTORY_QUERY, getSql } from "@/lib/db";
import type { ListingHistoryPoint, ListingHistoryResponse } from "@/lib/types";

// Zillow listing ids are 13-digit numeric strings, but the schema keys on
// (source, listing_id) and other sources use hashes/slugs. Accept a
// conservative URL-safe charset rather than guessing per source; anything
// outside it is a malformed request, not a missing listing.
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
