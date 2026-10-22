// WHAT:   GET /api/health — the ingestion-health payload (Health): last
//   successful/failed run, 30-day tallies, snapshot history depth, and the
//   sample-vs-market coverage figure, in one round trip.
// WHY:    roadmap 1.4. A gap in the daily trend line otherwise looks like a
//   broken site; this answers "why is there a hole?" before the client asks.
//   Falls back to the frozen sample (live:false) when Neon is unreachable so
//   the card still renders something honest. coveragePct keeps its rounding
//   rule here because it governs the coverage_pct FIELD (a number), which is a
//   different contract from fmtPct's display rule and coverageNote's wording.
// INPUTS: DATABASE_URL via lib/db/connection (HEALTH_QUERY); no request
//   params. MARKET_REFERENCE (lib/market) and CRON_SCHEDULE (lib/cron).
// OUTPUTS: Health JSON (live branch and frozen branch shaped identically).
// CALLERS: components/status/IngestionHealth.tsx only.
// Verified by: TS — Health (lib/api-types.ts) pins every field the card reads,
//   including coverage_pct: number | null (one decimal) and snapshot_days.
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/connection";
import { HEALTH_QUERY } from "@/lib/db/queries";
import { loadFallbackDeals } from "@/lib/fallback";
import { MARKET_REFERENCE } from "@/lib/market";
import { CRON_SCHEDULE, nextRunAt } from "@/lib/cron";
import { parseNum, pct1FromRatio } from "@/lib/format";
import { maxSnapshotDate } from "@/lib/dates";
import type { Health } from "@/lib/api-types";

// ---- helpers: driver-shape normalisation + coverage rounding ----
// json_build_object columns arrive already parsed over the HTTP driver; accept
// a JSON string too so the shape never depends on the driver revision.
// Verified by: TS — asObject returns Record<string, unknown> | null only, so
//   every read below is guarded against both driver shapes.
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

// The `coverage_pct` FIELD's rounding rule (lib/format.ts pct1FromRatio —
// round once to one decimal, as a number), distinct from fmtPct's display rule
// and from coverageNote's adaptive disclosure wording. Guard stays here.
// Verified by: TS — Health.coverage_pct: number | null (lib/api-types.ts),
//   one decimal via lib/format.ts pct1FromRatio.
const coveragePct = (tracked: number | null): number | null =>
  tracked != null && tracked > 0
    ? pct1FromRatio(tracked / MARKET_REFERENCE.listings)
    : null;

// ---- GET: live query → frozen-sample fallback (same Health shape) ----
// Ingestion health card (roadmap 1.4): last successful run, last failure,
// 30-day run tallies, history depth and coverage against MARKET_REFERENCE.
// One round trip; falls back to the frozen sample when Neon is unreachable so
// the card still renders something honest rather than an empty shell.
// Verified by: NOTHING (gap) — no runtime-gate key covers the health card.
export async function GET() {
  const next_run_at = nextRunAt(new Date());
  const market_reference = MARKET_REFERENCE.listings;

  try {
    const sql = getSql();
    const rows = (await sql(HEALTH_QUERY)) as Record<string, unknown>[];
    const r = rows[0] ?? {};
    const ok = asObject(r.last_success);
    const failed = asObject(r.last_failure);
    const tracked = parseNum(r.tracked);
    const body: Health = {
      live: true,
      last_success: ok
        ? {
            run_id: String(ok.run_id),
            finished_at: (ok.finished_at as string) ?? null,
            records_loaded: parseNum(ok.records_loaded),
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
      runs_ok_30d: parseNum(r.runs_ok_30d),
      runs_failed_30d: parseNum(r.runs_failed_30d),
      latest_snapshot_date: (r.latest_snapshot_date as string) ?? null,
      snapshot_days: parseNum(r.snapshot_days),
      tracked,
      market_reference,
      coverage_pct: coveragePct(tracked),
    };
    return NextResponse.json(body);
  } catch {
    const deals = await loadFallbackDeals();
    const latest = maxSnapshotDate(deals);
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
      // Verified by: /api/health frozen-branch snapshot_days → null (a frozen
      //   sample has no history depth to report).
      snapshot_days: null,
      tracked,
      market_reference,
      coverage_pct: coveragePct(tracked),
    };
    return NextResponse.json(body);
  }
}
