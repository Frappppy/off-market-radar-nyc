// WHAT:   MARKET_REFERENCE (the disclosure denominator), marketSizeLabel
//   ("~22.8k") and coverageNote() ("4.4% of ~22.8k Zillow NYC actives").
// WHY:    to state how small our sample honestly is — it exists for ONE
//   reason: a disclosure denominator, never a claim of coverage. The figure is
//   the citywide active-listing count Zillow reported during the 2026-10-15
//   stage-1 pre-check (jobs/smoke-scrape-20261015-084632/raw/process_log.md,
//   "reports 22801 total results"). It is order-of-magnitude, disclosure-only:
//   NOT derived from our dataset and not a property of any single run. The
//   ingestion is capped by design (robots-allowed paths, 5s pacing, abort on
//   any CAPTCHA challenge).
// Verified by: NOTHING (gap) — the disclosure-only rule is copy-level; no key
//   asserts the denominator's provenance.
// INPUTS: none — constants; coverageNote takes the tracked row count.
// OUTPUTS: the constant, a display label, and the coverage sentence (or null
//   when there is nothing honest to say).
// CALLERS: components/status/{HeroStats,IngestionHealth}.tsx,
//   app/api/health/route.ts; fmtCount re-exported for the header strip.
import { fmtPct } from "./format";

export { fmtCount } from "./format";

export const MARKET_REFERENCE = {
  listings: 22801,
  as_of: "2026-10-15",
  source: "zillow",
  label: "Zillow NYC actives",
} as const;

/** The whole-market size as a display string, e.g. `~22.8k`. */
export const marketSizeLabel = `~${(MARKET_REFERENCE.listings / 1000).toFixed(1)}k`;

/**
 * `"4.4% of ~22.8k Zillow NYC actives"` — or `null` when there is nothing
 * honest to say (no data yet). One decimal under 10% so small slices stay
 * legible instead of rounding to a whole number; the rule itself is
 * fmtPct's `"adaptive"` mode (lib/format.ts), unchanged.
 */
export function coverageNote(tracked: number | null | undefined): string | null {
  if (tracked == null || tracked <= 0) return null;
  const pct = (tracked / MARKET_REFERENCE.listings) * 100;
  return `${fmtPct(pct, "adaptive")} of ${marketSizeLabel} ${MARKET_REFERENCE.label}`;
}
