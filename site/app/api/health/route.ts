import { NextResponse } from "next/server";
import { HEALTH_QUERY, getSql } from "@/lib/db";
import { loadFallbackDeals } from "@/lib/fallback";
import { MARKET_REFERENCE } from "@/lib/market";
import { CRON_SCHEDULE, nextRunAt } from "@/lib/cron";
import type { Health } from "@/lib/types";

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// json_build_object columns arrive already parsed over the HTTP driver; accept
// a JSON string too so the shape never depends on the driver revision.
function asObject(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return null;
    }
  }
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

const coveragePct = (tracked: number | null): number | null =>
  tracked != null && tracked > 0
    ? Math.round((tracked / MARKET_REFERENCE.listings) * 1000) / 10
    : null;

// Ingestion health card (roadmap 1.4): last successful run, last failure,
// 30-day run tallies, history depth and coverage against MARKET_REFERENCE.
// One round trip; falls back to the frozen sample when Neon is unreachable so
// the card still renders something honest rather than an empty shell.
export async function GET() {
  const next_run_at = nextRunAt(new Date());
  const market_reference = MARKET_REFERENCE.listings;

  try {
    const sql = getSql();
    const rows = (await sql(HEALTH_QUERY)) as Record<string, unknown>[];
    const r = rows[0] ?? {};
    const ok = asObject(r.last_success);
    const failed = asObject(r.last_failure);
    const tracked = toNum(r.tracked);
    const body: Health = {
      live: true,
      last_success: ok
        ? {
            run_id: String(ok.run_id),
            finished_at: (ok.finished_at as string) ?? null,
            records_loaded: toNum(ok.records_loaded),
          }
        : null,
      last_failure: failed
        ? {
            run_id: String(failed.run_id),
            finished_at: (failed.finished_at as string) ?? null,
            notes: (failed.notes as string) ?? null,
          }
        : null,
      next_run_at,
      cron: CRON_SCHEDULE,
      runs_ok_30d: toNum(r.runs_ok_30d),
      runs_failed_30d: toNum(r.runs_failed_30d),
      latest_snapshot_date: (r.latest_snapshot_date as string) ?? null,
      snapshot_days: toNum(r.snapshot_days),
      tracked,
      market_reference,
      coverage_pct: coveragePct(tracked),
    };
    return NextResponse.json(body);
  } catch {
    const deals = await loadFallbackDeals();
    let latest: string | null = null;
    for (const d of deals) {
      if (d.snapshot_date && (!latest || d.snapshot_date > latest)) latest = d.snapshot_date;
    }
    const tracked = deals.length > 0 ? deals.length : null;
    const body: Health = {
      live: false,
      last_success: null,
      last_failure: null,
      next_run_at,
      cron: CRON_SCHEDULE,
      runs_ok_30d: null,
      runs_failed_30d: null,
      latest_snapshot_date: latest,
      // The bundled sample is a single frozen day, so we know no history depth
      // from it. null is the honest answer; 1 would imply we tracked the days
      // between then and now.
      snapshot_days: null,
      tracked,
      market_reference,
      coverage_pct: coveragePct(tracked),
    };
    return NextResponse.json(body);
  }
}
