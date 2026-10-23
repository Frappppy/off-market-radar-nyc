// WHAT:   GET /api/meta — the freshness strip payload (Meta): latest snapshot
//   date, last run's row count, and the snapshot-wide tracked/High totals.
// WHY:    the header strip (components/status/Freshness) and the hero
//   (HeroStats) need snapshot-global facts that /api/deals' filtered cohort
//   cannot give. One query pair, one payload, so the header and the hero can
//   never disagree. Falls back to the frozen sample (live:false) on DB error.
// INPUTS: DATABASE_URL via lib/db/connection; no request params. Fallback
//   branch reads public/data/listings_sample.csv via lib/fallback.
// OUTPUTS: Meta JSON. The fallback's snapshot_date is the FIRST sample row's
//   (a preserved divergence from /api/deals' max — see lib/dates.ts NOTE).
// CALLERS: hooks/useMeta (Freshness, HeroStats, InsightCards).
// Verified by: TS — Meta (lib/api-types.ts) is the one payload type every one
//   of those readers parses, so they cannot disagree on shape or source.
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/connection";
import { META_RUN_QUERY, META_SNAPSHOT_QUERY } from "@/lib/db/queries";
import { loadFallbackDeals } from "@/lib/fallback";
import type { Meta } from "@/lib/api-types";

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
      // The ledger (every listing ever ingested) beside the daily cohort, so
      // no reader mistakes the moving cohort for a shrinking database.
      total_ever_tracked:
        snap.total_ever_tracked != null ? Number(snap.total_ever_tracked) : null,
      high_count: snap.high_count != null ? Number(snap.high_count) : null,
    };
    return NextResponse.json(body);
  } catch {
    const deals = await loadFallbackDeals();
    const high = deals.filter((d) => d.motivation_score === "High").length;
    const body: Meta = {
      // DIVERGENCE preserved on purpose: this fallback reports the FIRST
      // fallback row's snapshot_date, NOT maxSnapshotDate(deals) as /api/deals
      // and /api/health do (see lib/dates.ts NOTE). Rewiring it to the max
      // could change the JSON whenever the frozen CSV is not newest-first, so
      // the previous output is kept byte-for-byte.
      // Verified by: NOTHING (gap) — no check pins the frozen branch's
      //   first-row snapshot_date against a rewrite.
      snapshot_date: deals[0]?.snapshot_date ?? null,
      records_loaded: deals.length,
      source: "zillow",
      run_id: "frozen-sample",
      live: false,
      total_tracked: deals.length,
      // In the frozen world the sample IS the whole ledger — one bundled day,
      // no history — so cohort and total are honestly the same number.
      total_ever_tracked: deals.length,
      high_count: high,
    };
    return NextResponse.json(body);
  }
}
