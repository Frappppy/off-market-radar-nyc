// Reference market size — captured by the stage-1 pre-check in the SAME session
// that produced the current snapshot. Zillow's own search page reported this
// many active NYC listings (see
// jobs/smoke-scrape-20261015-084632/raw/process_log.md, "reports 22801 total
// results"). Every record we hold came from that same session's search pages.
//
// It exists for ONE reason: to state how small our sample honestly is. It is a
// disclosure denominator, never a claim of coverage — the ingestion is capped by
// design (robots-allowed paths, 5s pacing, abort on any CAPTCHA challenge).
export const MARKET_REFERENCE = {
  listings: 22801,
  as_of: "2026-10-15",
  source: "zillow",
  label: "Zillow NYC actives",
} as const;

/** The whole-market size as a display string, e.g. `~22.8k`. */
export const marketSizeLabel = `~${(MARKET_REFERENCE.listings / 1000).toFixed(1)}k`;

/**
 * `"0.4% of ~22.8k Zillow NYC actives"` — or `null` when there is nothing
 * honest to say (no data yet).
 */
export function coverageNote(tracked: number | null | undefined): string | null {
  if (tracked == null || tracked <= 0) return null;
  const pct = (tracked / MARKET_REFERENCE.listings) * 100;
  const shown = pct < 1 ? pct.toFixed(1) : String(Math.round(pct));
  return `${shown}% of ${marketSizeLabel} ${MARKET_REFERENCE.label}`;
}
