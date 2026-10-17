"use client";
import { useUrlSearch } from "@/lib/useUrlSearch";
import { filterNotices } from "@/lib/useFilters";
import type { FilterState } from "@/lib/types";

// S8 — the visible half of the "we could not honour that param" story.
// Renders nothing at all when the link said only things we understood, so the
// common case (a fresh view) is unchanged. Shared by the full filter panel on
// /map and /data and by the compact toolbar on /, so both say the same words.
export default function FilterNotices({ value }: { value: FilterState }) {
  const sp = useUrlSearch();
  const notes = filterNotices(value, sp.get("score"), sp.get("min_dom"));
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs">
      {notes.map((n) => (
        <li key={n.text} className={n.tone === "warn" ? "text-amber-400" : "text-zinc-400"}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}
