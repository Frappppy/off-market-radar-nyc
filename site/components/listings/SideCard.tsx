"use client";
// WHAT:     the property detail card — a role="dialog" panel with the
//           listing's key stats, daily price history (sparkline + recorded
//           reductions), the shortlist toggle and a link to the standalone
//           /listing/[id] page.
// WHY:      one card opens from map pins (/map and the "/" overview) and from
//           /data rows. Its shortlist helpers moved to lib/shortlist.ts, the
//           reduction derivation to lib/reductions.ts and the history fetch to
//           hooks/useListingHistory.ts so the /listing/[id] page shares all
//           three (REFACTOR_PLAN §5 Phase 3) — this file only renders.
// INPUTS:   `deal` (null = render nothing), `onClose` (Close button + Escape),
//           `latestSnapshotDate` — the caller's newest-snapshot reference for
//           the "last seen" label when it has one (/api/deals payload).
// OUTPUTS:  the card markup; `picked` state stays in the caller.
// CALLERS:  components/explorer/{Compact,Full}Explorer, app/data/page.tsx.

import { useEffect } from "react";
import Link from "next/link";
import { useListingHistory } from "@/hooks/useListingHistory";
import { useShortlist } from "@/lib/shortlist";
import PriceHistoryBlock from "./PriceHistoryBlock";
import type { Deal } from "@/lib/api-types";
import { fmtMoney, fmtPct } from "@/lib/format";
import { daysSince, isCarriedOver, lastSeenLabel } from "@/lib/dates";
import { SCORE_COLORS, SCORE_PILL_TEXT } from "@/lib/scores";

export default function SideCard({
  deal,
  onClose,
  latestSnapshotDate = null,
}: {
  deal: Deal | null;
  onClose: () => void;
  latestSnapshotDate?: string | null;
}) {
  const hist = useListingHistory(deal?.listing_id ?? null, deal?.source ?? null);
  const { saved, toggle } = useShortlist(deal);

  // ---- keyboard dismissal (Escape) while the card is mounted ----
  // Keyboard dismissal. The card is a role="dialog" that a keyboard user opens
  // from a map pin (S1), and until now the only way out was to Tab to the Close
  // button — Escape did nothing (measured). The listener is only registered
  // while a card is mounted, and ignores modified chords so it cannot swallow
  // Ctrl/Escape or Alt+Escape from the top layer. Clicking or tapping outside
  // the map remains a mouse affordance only; Escape is the keyboard path.
  // Verified by: shots/phase3-runtime-gate.json → data_panel.closedByEscape
  //   (open side: openedByClick / openedByEnter).
  useEffect(() => {
    if (!deal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deal, onClose]);

  if (!deal) return null;

  const drop = deal.price_drop_pct != null ? fmtPct(deal.price_drop_pct) : "—";
  const addr = deal.address ?? deal.listing_id;

  // Reference date for freshness: the newest snapshot across the whole result
  // set when the caller has it (/api/deals), else this listing's own newest
  // snapshot. Both are data, neither is the client clock — so the label is
  // still correct when the page is cached or the machine clock is wrong.
  // Verified by: TS — daysSince takes YYYY-MM-DD strings only (lib/dates.ts);
  //   no Date.now() input exists on this path.
  const latestRef = latestSnapshotDate ?? hist.latest;
  const age = daysSince(deal.snapshot_date, latestRef);
  const lastSeen = lastSeenLabel(age);
  // age 0 = this row is in the newest daily run. age >= 1 = it was carried over
  // by the recency window, i.e. it was NOT in the latest run at all — the
  // distinction the old `age >= 2` threshold could never draw, because the
  // default window pinned exactly the newest snapshot and every row scored 0.
  // Verified by: /api/deals recency guard (window_days ≥ 1 is what makes a
  //   carried-over row possible at all); the badge render itself is a gap.
  const carriedOver = isCarriedOver(age);

  // ---- render: header + close | stats | history | actions ----
  return (
    <aside
      role="dialog"
      aria-label={`Property detail for ${addr}`}
      className="panel min-w-0 max-h-[70svh] overflow-y-auto p-3 text-zinc-200 shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-semibold">{addr}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close property detail"
          className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
        >
          Close
        </button>
      </div>

      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        <span
          className="rounded px-1"
          style={{
            background: SCORE_COLORS[deal.motivation_score],
            color: SCORE_PILL_TEXT[deal.motivation_score],
          }}
        >
          {deal.motivation_score}
        </span>
        <span className="rounded bg-zinc-800 px-1 text-zinc-200">DOM {deal.days_on_market ?? "—"}</span>
        <span className="rounded bg-zinc-800 px-1 text-zinc-200">drop {drop}</span>
        <span className="rounded bg-zinc-800 px-1 text-zinc-200">{deal.property_type ?? ""}</span>
      </div>

      <PriceHistoryBlock hist={hist} />

      <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-zinc-400">Price</dt>
        <dd className="tabular-nums">{deal.price != null ? fmtMoney(deal.price) : "—"}</dd>
        <dt className="text-zinc-400">$/sqft</dt>
        <dd className="tabular-nums">
          {deal.price_per_sqft != null ? `$${Number(deal.price_per_sqft).toFixed(0)}` : "—"}
        </dd>
        <dt className="text-zinc-400">DOM</dt>
        <dd className="tabular-nums">{deal.days_on_market ?? "—"}</dd>
        <dt className="text-zinc-400">ZIP</dt>
        <dd>{deal.zip ?? "—"}</dd>
        <dt className="text-zinc-400">Why</dt>
        <dd className="col-span-1 min-w-0 break-words">{deal.motivation_reason ?? "—"}</dd>
      </dl>

      <p
        className={`mt-2 text-[11px] ${carriedOver ? "text-amber-400" : "text-zinc-400"}`}
        title={`snapshot ${deal.snapshot_date}`}
      >
        {lastSeen}
        {carriedOver && (
          <>
            {" "}
            — snapshot {deal.snapshot_date}, not in the newest daily run
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {deal.url && (
          <a
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-100 underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
            href={deal.url}
            target="_blank"
            rel="noreferrer"
          >
            View on Zillow ↗
          </a>
        )}
        {/* The shareable page for this listing (D3) — the card stays the quick
            look; the page is the linkable one. `source` rides along because the
            history API is keyed on (source, listing_id), not the id alone. */}
        {/* Verified by: /api/listing/[id] — the route queries
            vw_listing_history by (source, listing_id), so `source` is required. */}
        <Link
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-100 underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
          href={`/listing/${encodeURIComponent(deal.listing_id)}?source=${encodeURIComponent(deal.source)}`}
        >
          Open full page →
        </Link>
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
          aria-pressed={saved}
          onClick={toggle}
        >
          {saved ? "Saved ✓" : "Add to shortlist"}
        </button>
      </div>
    </aside>
  );
}
