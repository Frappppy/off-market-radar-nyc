// WHAT:     the /data table's column model — SortKey, the eight COLUMNS with
//           their labels/numeric flags, the validated sort defaults, and the
//           cell/sort-value formatters.
// WHY:      the 402-line app/data/page.tsx mixed the column model with the
//           page wiring (REFACTOR_PLAN §5 Phase 3). Both functions and every
//           label moved verbatim, so the table renders exactly the same cells
//           and orders rows exactly as before.
// INPUTS:   a Deal row and a SortKey.
// OUTPUTS:  the display string for a cell (`cell`), the comparable value for
//           sorting (`sortVal` — rank for score, "zzz"/-Infinity for missing
//           text/number so unsorted nulls land last/first as before) and
//           `sortRows`, a stable copy-sort of the cohort.
// CALLERS:  app/data/page.tsx (defaults + parse guards + sorted memo),
//           app/data/deals-table.tsx (cell rendering + clickSort).
// Verified by: NOTHING (gap) — the null-sentinel ordering rule (zzz /
//   -Infinity, OUTPUTS above) has no check.

import { fmtMoney, fmtPct } from "@/lib/format";
import { SCORE_RANK } from "@/lib/scores";
import type { Deal } from "@/lib/api-types";

export type SortKey =
  | "address" | "zip" | "property_type" | "price"
  | "days_on_market" | "price_drop_pct" | "price_per_sqft" | "motivation_score";

export const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "address", label: "address" },
  { key: "zip", label: "zip" },
  { key: "property_type", label: "type" },
  { key: "price", label: "price", numeric: true },
  { key: "days_on_market", label: "DOM", numeric: true },
  { key: "price_drop_pct", label: "drop %", numeric: true },
  { key: "price_per_sqft", label: "$/sqft", numeric: true },
  { key: "motivation_score", label: "score" },
];

// View state lives in the URL (roadmap 1.3, defect D3): a shared link has to
// reproduce "sorted by DOM desc, page 3", not only the filters. Short, stable
// param names; every read is validated so a stale or hand-typed link degrades
// to the defaults instead of rendering an unsorted or empty table.
// Verified by: NOTHING (gap) — the runtime gate never loads a bad `sort=` URL.
export const DEFAULT_SORT: SortKey = "motivation_score";
export const DEFAULT_DIR: 1 | -1 = 1;

export const isSortKey = (v: string | null): v is SortKey =>
  v != null && COLUMNS.some((c) => c.key === v);

export function cell(d: Deal, key: SortKey): string {
  switch (key) {
    case "address": return d.address ?? "—";
    case "zip": return d.zip ?? "—";
    case "property_type": return d.property_type ?? "—";
    case "price": return d.price != null ? fmtMoney(d.price) : "—";
    case "days_on_market": return d.days_on_market != null ? String(d.days_on_market) : "—";
    case "price_drop_pct": return d.price_drop_pct != null ? fmtPct(d.price_drop_pct) : "—";
    case "price_per_sqft": return d.price_per_sqft != null ? `$${Number(d.price_per_sqft).toFixed(0)}` : "—";
    case "motivation_score": return d.motivation_score;
  }
}

// Module-local — only sortRows below reads it (REPO_MAP §8.2 spirit: no
// exporter without an importer).
// Verified by: TS — sortVal is module-private (never exported).
function sortVal(d: Deal, key: SortKey): number | string {
  if (key === "motivation_score") return SCORE_RANK[d.motivation_score] ?? 9;
  const v = (d as unknown as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  if (v == null) return key === "address" || key === "zip" || key === "property_type" ? "zzz" : -Infinity;
  return String(v);
}

// The /data sort comparator, moved verbatim out of the page's useMemo: numbers
// compare numerically, everything else through localeCompare, then × dir.
export function sortRows(deals: Deal[], key: SortKey, dir: 1 | -1): Deal[] {
  const arr = [...deals];
  arr.sort((a, b) => {
    const va = sortVal(a, key);
    const vb = sortVal(b, key);
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return cmp * dir;
  });
  return arr;
}
