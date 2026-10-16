import { NextResponse } from "next/server";
import { ZIPS_QUERY, getSql } from "@/lib/db";
import { loadFallbackTrends } from "@/lib/fallback";
import type { ZipTrend } from "@/lib/types";

export async function GET() {
  try {
    const sql = getSql();
    const rows = (await sql(ZIPS_QUERY)) as ZipTrend[];
    return NextResponse.json({ trends: rows, live: true });
  } catch {
    return NextResponse.json({ trends: await loadFallbackTrends(), live: false });
  }
}
