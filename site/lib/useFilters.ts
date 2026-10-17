"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { DEFAULT_FILTERS, type FilterState, type MotivationScore } from "@/lib/types";
// F1 — `useSearchParams()` here is what made every route ship
// BAILOUT_TO_CLIENT_SIDE_RENDERING. See lib/useUrlSearch.ts for the mechanism
// and the CLS number it caused; this is a drop-in read of the same params.
import { setUrlSearch, useUrlSearch } from "@/lib/useUrlSearch";

const SCORES: MotivationScore[] = ["High", "Medium", "Low"];
const isScore = (s: string): s is MotivationScore => (SCORES as string[]).includes(s);

// Empty-selection semantics (roadmap 1.3, defect D1): the `score` param is
// ABSENT on a fresh link → nobody has chosen yet → the defaults (High+Medium).
// A PRESENT BUT EMPTY `score=` → the user deliberately unticked every box →
// "all scores", i.e. no motivation filter at all. That is the server's reading
// too: api/deals/route.ts maps "" to [] and lib/db.ts then emits no
// motivation_score WHERE clause (an unknown token such as `score=Bogus` also
// collapses to [] on both sides). So `toDealsQuery` must always emit the param,
// empty included — omitting it would silently mean "defaults", not "all".
export function useFilters(): [
  FilterState,
  (patch: Partial<FilterState>, extra?: Record<string, string | null>) => void,
  () => void,
] {
  const sp = useUrlSearch();
  const router = useRouter();
  const pathname = usePathname();

  const state: FilterState = useMemo(() => {
    const rawScore = sp.get("score");
    const score = rawScore === null ? [...DEFAULT_FILTERS.score] : rawScore.split(",").filter(isScore);

    // `min_dom` (defect D2): absent → default. Present but empty → 0, matching
    // the API, which reads an empty min_dom as "no DOM floor". Anything
    // unparseable (`min_dom=abc`) → default, so a mistyped link cannot silently
    // WIDEN the filter — while a legitimate `min_dom=0` stays 0.
    const rawDom = sp.get("min_dom");
    const minDom =
      rawDom === null
        ? DEFAULT_FILTERS.minDom
        : rawDom === ""
          ? 0
          : Number.isFinite(Number(rawDom))
            ? Number(rawDom)
            : DEFAULT_FILTERS.minDom;

    return {
      score,
      minDom,
      minPrice: sp.get("min_price") ? Number(sp.get("min_price")) : null,
      maxPrice: sp.get("max_price") ? Number(sp.get("max_price")) : null,
      type: sp.get("type"),
      zips: (sp.get("zip") ?? "").split(",").filter(Boolean),
    };
  }, [sp]);

  // `extra` lets a page carry its own view params (e.g. /data's `page`) through
  // the SAME replace, so a filter change and a page reset cannot clobber each
  // other in two racing navigations. null deletes the param.
  const set = useCallback(
    (patch: Partial<FilterState>, extra?: Record<string, string | null>) => {
      const next = { ...state, ...patch };
      const p = new URLSearchParams(sp.toString());
      p.set("score", next.score.join(","));
      p.set("min_dom", String(next.minDom));
      if (next.minPrice != null) p.set("min_price", String(next.minPrice));
      else p.delete("min_price");
      if (next.maxPrice != null) p.set("max_price", String(next.maxPrice));
      else p.delete("max_price");
      if (next.type) p.set("type", next.type);
      else p.delete("type");
      if (next.zips.length > 0) p.set("zip", next.zips.join(","));
      else p.delete("zip");
      for (const [k, v] of Object.entries(extra ?? {})) {
        if (v == null) p.delete(k);
        else p.set(k, v);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
      setUrlSearch(p.toString());
    },
    [state, sp, router, pathname]
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
    setUrlSearch("");
  }, [router, pathname]);

  return [state, set, reset];
}

// Exactly the params /api/deals parses (score, min_dom, min_price, max_price,
// type, zip). `score` is always written: an empty value is the deliberate
// "all scores" selection, not a missing filter (see the semantic note above).
//
// `window_days` is deliberately NOT written: absent is the API's own default
// (1 = the newest snapshot plus the run before it), and this query string is
// also what the pages hand to /api/deals for their own fetches.
export function toDealsQuery(f: FilterState, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  p.set("score", f.score.join(","));
  p.set("min_dom", String(f.minDom));
  if (f.minPrice != null) p.set("min_price", String(f.minPrice));
  if (f.maxPrice != null) p.set("max_price", String(f.maxPrice));
  if (f.type) p.set("type", f.type);
  if (f.zips.length > 0) p.set("zip", f.zips.join(","));
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  return p.toString();
}

// ---- S8: disclosure for link params we could not honour --------------------
// `score=Bogus` collapses to [] on both sides, which the API reads as "no
// motivation filter" — so a typo silently WIDENED the result set and the UI
// said nothing about it. `min_dom=abc` does the same thing in reverse: it
// falls back to the default floor. Both data behaviours are deliberate and
// unchanged (see the D1/D2 notes above); these helpers exist so the filter
// panel can say what it did with the input instead of leaving the reader to
// guess. Pure functions, so the same wording is used on every page.

const SCORE_HINT = "High / Medium / Low";

export interface FilterNotice {
  tone: "warn" | "info";
  text: string;
}

/** Score tokens the reader sent that are not High/Medium/Low. */
export function unrecognisedScores(raw: string | null): string[] {
  if (raw == null) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s !== "" && !isScore(s));
}

/** The raw `min_dom` value when it was present but not a usable number. */
export function unrecognisedMinDom(raw: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  return Number.isFinite(Number(raw)) ? null : raw.trim();
}

/** Everything the panel should disclose about the current link, in one place. */
export function filterNotices(
  value: FilterState,
  rawScore: string | null,
  rawDom: string | null
): FilterNotice[] {
  const out: FilterNotice[] = [];
  const badScores = unrecognisedScores(rawScore);
  if (badScores.length > 0) {
    const quoted = badScores.map((s) => `\u201c${s}\u201d`).join(", ");
    out.push({
      tone: "warn",
      text: `${quoted} ${
        badScores.length === 1 ? "is not a motivation score" : "are not motivation scores"
      } (${SCORE_HINT}) \u2014 ignored, so this view ${
        value.score.length === 0 ? "shows every score" : `shows ${value.score.join(", ")}`
      }.`,
    });
  }
  const badDom = unrecognisedMinDom(rawDom);
  if (badDom != null) {
    out.push({
      tone: "warn",
      text: `\u201c${badDom}\u201d is not a number \u2014 the DOM floor fell back to ${value.minDom} days.`,
    });
  }
  if (badScores.length === 0 && value.score.length === 0) {
    out.push({ tone: "info", text: "No score selected \u2014 showing all scores." });
  }
  return out;
}

