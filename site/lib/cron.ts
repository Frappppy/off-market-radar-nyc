// WHAT:   CRON_SCHEDULE ("0 10 * * *") and nextRunAt(now) — the pipeline's
//   daily schedule and its next fire time in ISO 8601.
// WHY:    the health card must show when the next ingest runs; this lives in
//   lib/ rather than in app/api/health/route.ts because Next 15 type-checks
//   route modules against a fixed export allowlist (GET, dynamic, runtime,
//   revalidate, …) and fails the build on any other named export.
//   10:00 UTC, UTC has no DST → plain arithmetic; one expression does not
//   justify a cron library on a Hobby-budget app.
// Verified by: TS — only CRON_SCHEDULE/nextRunAt are exported, and
//   npm run typecheck (Next's route allowlist) fails the build otherwise.
// INPUTS: `now` (a Date) for nextRunAt; nothing for CRON_SCHEDULE.
// OUTPUTS: the cron string; the next 10:00 UTC strictly after `now`.
// CALLERS: app/api/health/route.ts, components/status/IngestionHealth.tsx.
export const CRON_SCHEDULE = "0 10 * * *";

const CRON_HOUR_UTC = 10;

/** The next 10:00 UTC strictly after `now`, as ISO 8601 with `Z`. */
export function nextRunAt(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_HOUR_UTC, 0, 0, 0)
  );
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
