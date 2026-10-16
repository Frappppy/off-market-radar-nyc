import { NextResponse } from "next/server";
import { META_RUN_QUERY, META_SNAPSHOT_QUERY, getSql } from "@/lib/db";
import { loadFallbackDeals } from "@/lib/fallback";
import type { Meta } from "@/lib/types";

// Freshness strip: latest successful pipeline run + current snapshot totals.
// Falls back to the bundled sample when Neon is unreachable (free-tier sleep).
export async function GET() {
  try {
    const sql = getSql();
    const [runs, snaps] = await Promise.all([
      sql(META_RUN_QUERY),
      sql(META_SNAPSHOT_QUERY),
    ]);
    const run = (runs as Record<string, unknown>[])[0] ?? {};
    const snap = (snaps as Record<string, unknown>[])[0] ?? {};
    const body: Meta = {
      snapshot_date: (snap.snapshot_date as string) ?? null,
      records_loaded: (run.records_loaded as number) ?? null,
      source: (run.source as string) ?? "zillow",
      run_id: (run.run_id as string) ?? null,
      live: true,
      total_tracked: snap.total_tracked != null ? Number(snap.total_tracked) : null,
      high_count: snap.high_count != null ? Number(snap.high_count) : null,
    };
    return NextResponse.json(body);
  } catch {
    const deals = await loadFallbackDeals();
    const high = deals.filter((d) => d.motivation_score === "High").length;
    const body: Meta = {
      snapshot_date: deals[0]?.snapshot_date ?? null,
      records_loaded: deals.length,
      source: "zillow",
      run_id: "frozen-sample",
      live: false,
      total_tracked: deals.length,
      high_count: high,
    };
    return NextResponse.json(body);
  }
}
