"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { DEFAULT_FILTERS, type FilterState, type MotivationScore } from "@/lib/types";

// Single source of truth: URL search params (shareable links). One filter set
// drives map + KPIs + table + CSV export (websiteplan §4).
export function useFilters(): [FilterState, (patch: Partial<FilterState>) => void, () => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state: FilterState = useMemo(() => {
    const score = (sp.get("score") ?? "High,Medium")
      .split(",")
      .filter((s): s is MotivationScore => ["High", "Medium", "Low"].includes(s));
    return {
      score: score.length > 0 ? score : [...DEFAULT_FILTERS.score],
      minDom: Number(sp.get("min_dom") ?? DEFAULT_FILTERS.minDom) || 0,
      minPrice: sp.get("min_price") ? Number(sp.get("min_price")) : null,
      maxPrice: sp.get("max_price") ? Number(sp.get("max_price")) : null,
      type: sp.get("type"),
      zips: (sp.get("zip") ?? "").split(",").filter(Boolean),
    };
  }, [sp]);

  const set = useCallback(
    (patch: Partial<FilterState>) => {
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
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [state, sp, router, pathname]
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return [state, set, reset];
}

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
