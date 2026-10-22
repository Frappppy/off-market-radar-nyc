// WHAT: deal-row date/identity helpers — `maxSnapshotDate` (newest
//   snapshot_date across rows), `listingKey` (the `source:listing_id` row key)
//   and the recency-label family (`daysSince`, `lastSeenLabel`,
//   `isCarriedOver`, `carriedOverBadge`).
// WHY: three copies of the max (api/deals, api/health's fallback,
//   api/meta's fallback) and three of the key builder (SideCard's shortKey,
//   /data's rowKey, /trends inline template literal) — REFACTOR_PLAN §5 Phase 1.
//   The recency-label family moved here from lib/types.ts (REFACTOR_PLAN §5
//   Phase 3): same inputs (a snapshot date + the payload's newest), same
//   outputs, no logic change.
// INPUTS: Deal rows from the API payloads or the frozen-CSV fallback, or plain
//   YYYY-MM-DD / age-in-days values for the label helpers.
// OUTPUTS: `"YYYY-MM-DD" | null` (maxSnapshotDate), `"source:listing_id"`
//   (listingKey), the whole-day age (`daysSince`) and its display forms — all
//   byte-identical to the code they replace.
// CALLERS: app/api/{deals,health}, components/listings/SideCard, app/data,
//   app/trends (listingKey row keys), the /listing/[id] page.
// NOTE: app/api/meta's fallback deliberately does NOT use maxSnapshotDate —
//   see the comment at its `deals[0]?.snapshot_date` call site.

import type { Deal } from "./api-types";

// Newest snapshot_date across the returned rows — no extra query needed, and
// it is the same value the recency guard anchored on. YYYY-MM-DD sorts
// lexicographically, so a string max is exact.
// Verified by: /api/deals recency guard — both sides anchor on
//   max(snapshot_date); TS proves the lexicographic string compare.
export function maxSnapshotDate(deals: Deal[]): string | null {
  let max = "";
  for (const d of deals) {
    if (d.snapshot_date && d.snapshot_date > max) max = d.snapshot_date;
  }
  return max || null;
}

/** The row key: React keys, shortlist entries and the picked-row comparison
 *  all spell `(source, listing_id)` the same way. */
export const listingKey = (d: Deal): string => `${d.source}:${d.listing_id}`;

// Whole-day difference of two YYYY-MM-DD strings; null when either is missing
// or unparseable. Powers the "last seen N days ago" label (roadmap 1.1). Pure:
// no Intl, no Date.now() — the dataset's newest snapshot is the reference, so
// the label stays correct even weeks after the bundle was built.
function dayNumber(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}

export function daysSince(
  snapshotDate: string | null,
  latestSnapshotDate: string | null
): number | null {
  if (!snapshotDate || !latestSnapshotDate) return null;
  const a = dayNumber(snapshotDate);
  const b = dayNumber(latestSnapshotDate);
  if (a == null || b == null) return null;
  return b - a;
}

// One wording, two surfaces (the /data table row and the detail panel), so the
// two can never drift apart. `age` is (newest snapshot − this row's snapshot)
// in whole days, i.e. the output of daysSince. The reference is always a
// snapshot date from the payload, never the browser clock: the dataset is a
// snapshot, so the label must still be right when the page is cached, when the
// bundle is stale, or when the reader's machine clock is wrong.
// Verified by: TS — lastSeenLabel takes only `age` (no Date/Intl import in
//   this module), so no clock can reach it; the wording is NOTHING (gap).
export function lastSeenLabel(age: number | null): string {
  if (age == null) return "last seen —";
  if (age <= 0) return "last seen today";
  if (age === 1) return "last seen yesterday";
  return `last seen ${age} days ago`;
}

// True when the row was NOT part of the newest daily run and only reached the
// page through the recency window (window_days >= 1). Those rows are
// meaningfully different from the current cohort and are marked as such.
// Verified by: /api/deals recency guard — window_days >= 1 is what lets such
//   rows through; the badge itself is NOTHING (gap).
export function isCarriedOver(age: number | null): boolean {
  return age != null && age >= 1;
}

// Short row-level form of the same fact, for surfaces with no room for the
// sentence above (the /data table).
export function carriedOverBadge(age: number | null): string | null {
  if (!isCarriedOver(age)) return null;
  return age === 1 ? "1d" : `${age}d`;
}
