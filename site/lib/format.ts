// WHAT: shared display formatting — money (`$1,234`), percent (`3.2%`, with
//   the two coverage-percent rounding rules parameterised as `PctRule` and
//   `pct1FromRatio`), counts (locale-grouped integers), the compact USD label
//   (`$1.23M` / `$850k`) and null-number parsing (`parseNum`).
// WHY: the money/percent/parse family was re-implemented in ~10 places
//   (SideCard, Explorer, /data, /trends, HeroStats, IngestionHealth, lib/market,
//   lib/fallback, app/api/deals, app/api/health) — REFACTOR_PLAN §5 Phase 1.
// INPUTS: plain numbers from the API payloads; `parseNum` accepts unknown
//   scalars (query params, CSV cells, driver values).
// OUTPUTS: display strings byte-identical to the inline code they replace, and
//   `number | null` from parseNum. Null-handling stays AT each call site (each
//   surface has its own fallback wording), so every helper here takes a plain
//   `number` unless the original already swallowed null itself (fmtUsd).
// CALLERS: components/{SideCard,Explorer,HeroStats,IngestionHealth},
//   app/{data,trends}, lib/{market,fallback}, app/api/{deals,health}.

/** Fixed locale so server and client always agree on formatting.
 *  Verified by: TS — a module const; no call site can pass another locale. */
const COUNT_FMT = new Intl.NumberFormat("en-US");

/** `1011` -> `"1,011"`. Moved verbatim from lib/market.ts (re-exported there). */
export const fmtCount = (n: number): string => COUNT_FMT.format(n);

/** `449000` -> `"$449,000"`. The `−` sign glyph some call sites need belongs
 *  at the call site; this only adds the currency sign.
 *  en-US on purpose, like fmtCount: `v.toLocaleString()` reads the RUNTIME's
 *  default locale, so a prerendered (server, en-US) "$449,000" and a client in
 *  a de-DE/fr-FR browser ("449.000"/"449 000") disagreed — a hydration text
 *  mismatch on every price on the page, and the same listing read two ways in
 *  two browsers. One fixed locale keeps the string stable everywhere.
 *  Verified by: TS — MONEY_FMT is module-level; no call site can pass a
 *   locale. Nothing runs this under a non-en-US default locale (gap). */
const MONEY_FMT = new Intl.NumberFormat("en-US");
export const fmtMoney = (v: number): string => `$${MONEY_FMT.format(v)}`;

/** The two coverage-percent rounding rules the site has always had, kept
 *  distinct on purpose so each surface outputs EXACTLY what it used to:
 *  - `"tenth"` (default): one decimal, always — price drops, KPI cells, and
 *    /api/health's coverage_pct as IngestionHealth re-renders it.
 *  - `"adaptive"`: one decimal BELOW 10%, whole number at or above — exactly
 *    lib/market.coverageNote's disclosure wording (4.4%, then 27%), where a
 *    tenth digit past 10% would add false precision to a sample claim. */
export type PctRule = "tenth" | "adaptive";

/** `4.4499` -> `"4.4%"`. Callers keep their own null / unknown guard and
 *  fallback wording ("—", "no data", "sample size unknown"). */
export const fmtPct = (v: number, rule: PctRule = "tenth"): string =>
  `${rule === "adaptive" && v >= 10 ? String(Math.round(v)) : v.toFixed(1)}%`;

/** The OTHER coverage rounding rule — /api/health's `coverage_pct` FIELD: a
 *  NUMBER in the JSON contract (rounded once, server-side, and only
 *  re-formatted by the client), not a display string, so it cannot be fmtPct.
 *  The `ratio * 1000) / 10` shape is kept verbatim from the route's original
 *  `Math.round((tracked / listings) * 1000) / 10` (NOT `ratio * 100` then
 *  `* 10`) so the float rounding stays bit-identical. Callers keep their own
 *  null guard (`tracked == null || tracked <= 0 -> null`). */
// Verified by: /api/health coverage_pct invariant — the route rounds once
//   server-side with this exact expression; TS keeps the field a number.
export const pct1FromRatio = (ratio: number): number => Math.round(ratio * 1000) / 10;

/** Compact USD for KPI cells: `1_250_000` -> `"$1.25M"`, `850_000` -> `"$850k"`,
 *  null -> `"—"`. Moved verbatim from app/trends/page.tsx. */
export const fmtUsd = (v: number | null) =>
  v == null ? "—" : `$${v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${Math.round(v / 1000)}k`}`;

/** `null` / `""` / unparseable -> null; anything numeric -> the number.
 *  This single body replaces FOUR copies with identical bodies: lib/fallback
 *  `num(string)`, api/deals `numOrNull(string|null)`, api/health
 *  `toNum(unknown)` and SideCard's `num(number|null)` — the last one's
 *  `typeof v === "number" && Number.isFinite(v)` guard is the same contract at
 *  runtime for a `number|null` input (`Number(n) === n`, null/undefined hit the
 *  `== null` branch). Note: whitespace-only strings parse to 0 (`Number(" ")`),
 *  exactly as all four originals did — preserved, not "fixed". */
export const parseNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
