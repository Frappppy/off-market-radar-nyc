"use client";
import ShareLink from "./ShareLink";
import type { FilterState, MotivationScore } from "@/lib/types";

const SCORES: MotivationScore[] = ["High", "Medium", "Low"];
const TYPES = ["house", "condo", "co-op", "townhouse", "multi-family", "land", "other"];

export default function Filters({
  value,
  onChange,
  onReset,
  shown,
  total,
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  shown: number | null;
  total: number | null;
}) {
  const toggleScore = (s: MotivationScore) => {
    const has = value.score.includes(s);
    onChange({ score: has ? value.score.filter((x) => x !== s) : [...value.score, s] });
  };
  return (
    <aside className="panel space-y-3 p-3 text-sm text-zinc-200">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Filters</span>
        <button className="text-xs underline" onClick={onReset}>Reset</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <span>{total != null ? `${shown ?? "…"} of ${total} shown` : `${shown ?? "…"} shown`}</span>
        {/* The filter panel is where a view is composed, so it is where the
            shareable link belongs (roadmap 1.3). */}
        <ShareLink />
      </div>
      <div>
        <label className="font-medium text-zinc-100">Source</label>
        <select disabled className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 p-1" value="zillow">
          <option value="zillow">Zillow</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="font-medium text-zinc-100">Country</label>
          <select disabled className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 p-1" value="USA">
            <option>USA</option>
          </select>
        </div>
        <div>
          <label className="font-medium text-zinc-100">City</label>
          <select disabled className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 p-1" value="New York">
            <option>New York</option>
          </select>
        </div>
      </div>
      <div>
        <label className="font-medium text-zinc-100">Motivation</label>
        <div className="mt-1 flex gap-2">
          {SCORES.map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="checkbox" checked={value.score.includes(s)} onChange={() => toggleScore(s)} />
              {s}
            </label>
          ))}
        </div>
        {/* Unticking every box is a deliberate "no score filter", not a broken
            panel: say so, because the table keeps returning rows. */}
        {value.score.length === 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            No score selected — showing <span className="text-zinc-300">all</span> scores.
          </p>
        )}
      </div>
      <div>
        <label className="font-medium text-zinc-100">DOM ≥ {value.minDom} days</label>
        <input
          type="range" min={0} max={180} step={5} value={value.minDom}
          onChange={(e) => onChange({ minDom: Number(e.target.value) })}
          className="w-full"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="font-medium text-zinc-100">Min price</label>
          <input
            type="number" placeholder="No min" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-1"
            value={value.minPrice ?? ""} onChange={(e) => onChange({ minPrice: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
        <div>
          <label className="font-medium text-zinc-100">Max price</label>
          <input
            type="number" placeholder="No max" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-1"
            value={value.maxPrice ?? ""} onChange={(e) => onChange({ minPrice: value.minPrice, maxPrice: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
      </div>
      <div>
        <label className="font-medium text-zinc-100">Type</label>
        <select
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-1"
          value={value.type ?? ""}
          onChange={(e) => onChange({ type: e.target.value || null })}
        >
          <option value="">Any</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="font-medium text-zinc-100">ZIPs (comma-separated)</label>
        <input
          type="text" placeholder="All ZIPs" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-1"
          value={value.zips.join(", ")}
          onChange={(e) => onChange({ zips: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </div>
    </aside>
  );
}
