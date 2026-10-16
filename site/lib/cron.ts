// Daily pipeline schedule — the GitHub Actions cron that scrapes, cleans and
// loads into Neon (docs/websiteplan.md §5, .github/workflows).
//
// This lives in lib/ rather than in app/api/health/route.ts because Next 15
// type-checks route modules against a fixed export allowlist (GET, dynamic,
// runtime, revalidate, …) and fails the build on any other named export. The
// health card still publishes the value in its JSON body.
export const CRON_SCHEDULE = "0 10 * * *";

// 10:00 UTC, matching the cron hour above. UTC has no DST, so the next run is
// plain arithmetic — one expression does not justify a cron library on a
// Hobby-budget app.
const CRON_HOUR_UTC = 10;

/** The next 10:00 UTC strictly after `now`, as ISO 8601 with `Z`. */
export function nextRunAt(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_HOUR_UTC, 0, 0, 0)
  );
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
