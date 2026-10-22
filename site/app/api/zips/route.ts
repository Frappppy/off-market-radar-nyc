// WHAT:   GET /api/zips — per-ZIP 30-day trend points (ZipTrend[]) for the
//   /trends charts; falls back to a single-point-per-ZIP aggregate of the
//   frozen sample when Neon is unreachable.
// WHY:    the /trends ZIP charts need one endpoint that answers from
//   vw_zip_price_drop_30d live, and from the bundled CSV offline — the
//   fallback aggregate is demo-only and honestly single-snapshot (lib/fallback
//   says so at its own definition; no second explanation here).
//   Verified by: NOTHING (gap) — nothing asserts the fallback aggregate is
//   single-snapshot / demo-only.
// INPUTS: DATABASE_URL via lib/db/connection; no request params.
// OUTPUTS: { trends: ZipTrend[], live: boolean } JSON.
// CALLERS: app/trends/page.tsx (ZIP charts + top-deals).
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/connection";
import { ZIPS_QUERY } from "@/lib/db/queries";
import { loadFallbackTrends } from "@/lib/fallback";
import type { ZipTrend } from "@/lib/api-types";

export async function GET() {
  try {
    const sql = getSql();
    const rows = (await sql(ZIPS_QUERY)) as ZipTrend[];
    return NextResponse.json({ trends: rows, live: true });
  } catch {
    return NextResponse.json({ trends: await loadFallbackTrends(), live: false });
  }
}
