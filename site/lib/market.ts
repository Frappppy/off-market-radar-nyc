// Reference market size — the citywide active-listing count Zillow reported
// during the 2026-10-15 stage-1 pre-check (see
// jobs/smoke-scrape-20261015-084632/raw/process_log.md, "reports 22801 total
// results"). It is an order-of-magnitude figure used for disclosure only: it is
// NOT derived from our dataset, and it is not a property of any single run.
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

// Fixed locale so server and client always agree on formatting.
const COUNT_FMT = new Intl.NumberFormat("en-US");

/** `1011` -> `"1,011"`. */
export const fmtCount = (n: number): string => COUNT_FMT.format(n);

/**
 * `"4.4% of ~22.8k Zillow NYC actives"` — or `null` when there is nothing
 * honest to say (no data yet). One decimal under 10% so small slices stay
 * legible instead of rounding to a whole number.
 */
export function coverageNote(tracked: number | null | undefined): string | null {
  if (tracked == null || tracked <= 0) return null;
  const pct = (tracked / MARKET_REFERENCE.listings) * 100;
  const shown = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
  return `${shown}% of ${marketSizeLabel} ${MARKET_REFERENCE.label}`;
}
