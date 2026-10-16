"use client";
import { SCORE_COLORS, type Deal } from "@/lib/types";

const shortKey = (d: Deal) => `${d.source}:${d.listing_id}`;

export function toggleShortlist(d: Deal): boolean {
  // V1: browser localStorage only (websiteplan §2). Returns true if now saved.
  const raw = localStorage.getItem("shortlist");
  const list: string[] = raw ? JSON.parse(raw) : [];
  const k = shortKey(d);
  const next = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
  localStorage.setItem("shortlist", JSON.stringify(next));
  return next.includes(k);
}

export default function SideCard({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  if (!deal) return null;
  const drop = deal.price_drop_pct != null ? `${deal.price_drop_pct.toFixed(1)}%` : "—";
  return (
    <div className="panel p-3 text-zinc-200 shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{deal.address ?? deal.listing_id}</h3>
        <button className="text-xs underline" onClick={onClose}>Close</button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        <span className="rounded px-1 text-white" style={{ background: SCORE_COLORS[deal.motivation_score] }}>
          {deal.motivation_score}
        </span>
        <span className="rounded bg-zinc-800 px-1 text-zinc-200">DOM {deal.days_on_market ?? "—"}</span>
        <span className="rounded bg-zinc-800 px-1 text-zinc-200">drop {drop}</span>
        <span className="rounded bg-zinc-800 px-1 text-zinc-200">{deal.property_type ?? ""}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-zinc-400">Price</dt>
        <dd>{deal.price != null ? `$${deal.price.toLocaleString()}` : "—"}</dd>
        <dt className="text-zinc-400">$/sqft</dt>
        <dd>{deal.price_per_sqft != null ? `$${Number(deal.price_per_sqft).toFixed(0)}` : "—"}</dd>
        <dt className="text-zinc-400">ZIP</dt>
        <dd>{deal.zip ?? "—"}</dd>
        <dt className="text-zinc-400">Why</dt>
        <dd className="col-span-1">{deal.motivation_reason ?? "—"}</dd>
      </dl>
      <div className="mt-2 flex gap-2 text-sm">
        {deal.url && (
          <a className="rounded border border-zinc-700 px-2 py-1 text-zinc-100 underline" href={deal.url} target="_blank" rel="noreferrer">
            View on Zillow ↗
          </a>
        )}
        <button
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-100"
          onClick={(e) => {
            const saved = toggleShortlist(deal);
            (e.target as HTMLButtonElement).textContent = saved ? "Saved ✓" : "Add to shortlist";
          }}
        >
          Add to shortlist
        </button>
      </div>
    </div>
  );
}
