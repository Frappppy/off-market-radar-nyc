"use client";
import { useEffect, useState } from "react";
import PriceSparkline from "./PriceSparkline";
import {
  SCORE_COLORS,
  SCORE_PILL_TEXT,
  daysSince,
  isCarriedOver,
  lastSeenLabel,
  type Deal,
  type ListingHistoryPoint,
  type ListingHistoryResponse,
} from "@/lib/types";

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

// localStorage is unavailable during SSR, so the saved flag is read in an
// effect, never during render. Same key as toggleShortlist above.
function isShortlisted(d: Deal): boolean {
  try {
    const raw = localStorage.getItem("shortlist");
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) && list.includes(shortKey(d));
  } catch {
    return false;
  }
}

const num = (v: number | null): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const money = (v: number) => `$${v.toLocaleString()}`;

type Reduction = { date: string; from: number; to: number; abs: number; pct: number };

// Every recorded reduction, newest first (roadmap 1.2).
// Trigger: the day's price is below the comparison price. The cut is only shown
// with arithmetic behind it — a row flagged price_reduced but priced at or above
// its comparison price is contradictory data, and inventing a "−$0" line would
// be worse than omitting it. The flag itself is never read here, because the
// arithmetic already implies it.
// Comparison price: the day's own `previous_price` when the column carries it
// (the scraper's record of what the price was), otherwise the nearest earlier
// priced day in this same series (our own view of it). Recorded value wins.
//
// `previous_price` is a persistent column carried on every daily row, so the
// recorded branch would otherwise re-emit the SAME cut once per snapshot day
// (e.g. 315000→295000 on both 10-15 and 10-16 for a listing cut once). A cut is
// only new on a day whose price differs from the previous day we saw — the day
// the new price first appears — so an unchanged price cannot record it twice.
// That keeps two genuinely distinct cuts (1049999→1049000, 1049000→999000)
// apart while collapsing the carried-over duplicate.
function reductionsFrom(points: ListingHistoryPoint[]): Reduction[] {
  const sorted = [...points].sort((a, b) =>
    a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0
  );
  const out: Reduction[] = [];
  let prevSeriesPrice: number | null = null;
  for (const p of sorted) {
    const price = num(p.price);
    const recorded = num(p.previous_price);
    const movedSincePrev = price != null && (prevSeriesPrice == null || price !== prevSeriesPrice);
    let from: number | null = null;
    if (movedSincePrev && price != null && recorded != null && recorded > 0 && price < recorded) from = recorded;
    else if (price != null && prevSeriesPrice != null && price < prevSeriesPrice) from = prevSeriesPrice;
    if (price != null && from != null) {
      out.push({
        date: p.snapshot_date,
        from,
        to: price,
        abs: from - price,
        pct: ((from - price) / from) * 100,
      });
    }
    if (price != null) prevSeriesPrice = price;
  }
  return out.reverse();
}

const REDUCTIONS_SHOWN = 6;

type HistoryState = {
  status: "loading" | "ready" | "error";
  points: ListingHistoryPoint[];
  latest: string | null;
  unavailable: boolean;
};
const LOADING: HistoryState = { status: "loading", points: [], latest: null, unavailable: false };

export default function SideCard({
  deal,
  onClose,
  latestSnapshotDate = null,
}: {
  deal: Deal | null;
  onClose: () => void;
  latestSnapshotDate?: string | null;
}) {
  const listingId = deal?.listing_id ?? null;
  const source = deal?.source ?? null;

  const [hist, setHist] = useState<HistoryState>(LOADING);
  const [saved, setSaved] = useState(false);

  // History is fetched per (source, listing_id), and the previous request is
  // aborted when the pin changes: rapid pin-to-pin clicking must not let an
  // older response land on top of a newer pin's card.
  useEffect(() => {
    if (!listingId || !source) return;
    const ctrl = new AbortController();
    setHist(LOADING);
    fetch(`/api/listing/${encodeURIComponent(listingId)}?source=${encodeURIComponent(source)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: ListingHistoryResponse) => {
        const points = Array.isArray(j.history) ? j.history : [];
        setHist({
          status: "ready",
          points,
          latest: j.latest_snapshot_date ?? null,
          // The route answers 200 with `unavailable` when the history view is
          // not readable (grant not applied / Neon asleep). live=false with no
          // rows is the same story: no history, say so, do not chart nothing.
          unavailable: j.unavailable === true || (j.live === false && points.length === 0),
        });
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setHist({ status: "error", points: [], latest: null, unavailable: false });
      });
    return () => ctrl.abort();
  }, [listingId, source]);

  useEffect(() => {
    setSaved(deal ? isShortlisted(deal) : false);
  }, [deal]);

  // Keyboard dismissal. The card is a role="dialog" that a keyboard user opens
  // from a map pin (S1), and until now the only way out was to Tab to the Close
  // button — Escape did nothing (measured). The listener is only registered
  // while a card is mounted, and ignores modified chords so it cannot swallow
  // Ctrl/Escape or Alt+Escape from the top layer. Clicking or tapping outside
  // the map remains a mouse affordance only; Escape is the keyboard path.
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

  const drop = deal.price_drop_pct != null ? `${deal.price_drop_pct.toFixed(1)}%` : "—";
  const addr = deal.address ?? deal.listing_id;

  const points = hist.points;
  const priced = points.filter((p) => num(p.price) != null);
  const reductions = reductionsFrom(points);
  const shown = reductions.slice(0, REDUCTIONS_SHOWN);
  const hidden = reductions.length - shown.length;

  // Reference date for freshness: the newest snapshot across the whole result
  // set when the caller has it (/api/deals), else this listing's own newest
  // snapshot. Both are data, neither is the client clock — so the label is
  // still correct when the page is cached or the machine clock is wrong.
  const latestRef = latestSnapshotDate ?? hist.latest;
  const age = daysSince(deal.snapshot_date, latestRef);
  const lastSeen = lastSeenLabel(age);
  // age 0 = this row is in the newest daily run. age >= 1 = it was carried over
  // by the recency window, i.e. it was NOT in the latest run at all — the
  // distinction the old `age >= 2` threshold could never draw, because the
  // default window pinned exactly the newest snapshot and every row scored 0.
  const carriedOver = isCarriedOver(age);

  const firstPriced = priced[0] ? num(priced[0].price) : null;
  const lastPriced = priced[priced.length - 1] ? num(priced[priced.length - 1].price) : null;

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

      <div className="mt-3 min-w-0">
        <p className="eyebrow">Price history</p>

        {hist.status === "loading" && <p className="mt-1 text-[11px] text-zinc-500">loading history…</p>}

        {hist.status === "error" && (
          <p className="mt-1 text-[11px] text-zinc-500">price history unavailable — the request failed</p>
        )}

        {hist.status === "ready" && hist.unavailable && (
          <p className="mt-1 text-[11px] text-zinc-500">
            price history unavailable — the history view is not granted yet
          </p>
        )}

        {hist.status === "ready" && !hist.unavailable && points.length === 0 && (
          <p className="mt-1 text-[11px] text-zinc-500">no daily snapshots recorded for this listing yet</p>
        )}

        {hist.status === "ready" && !hist.unavailable && points.length > 0 && (
          <div className="mt-1 min-w-0">
            <PriceSparkline points={points.map((p) => ({ snapshot_date: p.snapshot_date, price: p.price }))} />
            <p className="mt-1 text-[11px] text-zinc-500">
              {points.length === 1
                ? "1 snapshot so far — the series grows with each daily run, so this is not yet a trend."
                : `${points.length} daily snapshots.`}
              {priced.length === 0 ? " No price recorded in these snapshots yet." : ""}
            </p>
            {priced.length >= 2 && firstPriced != null && lastPriced != null && (
              <p className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">
                {money(firstPriced)} → {money(lastPriced)}{" "}
                <span className="text-zinc-500">(oldest → newest snapshot)</span>
              </p>
            )}

            {shown.length > 0 && (
              <div className="mt-2 min-w-0">
                <p className="eyebrow">Recorded reductions</p>
                <ul className="mt-1 space-y-1">
                  {shown.map((r) => (
                    <li key={r.date} className="min-w-0 break-words text-xs leading-5 text-zinc-300">
                      <span className="tabular-nums text-zinc-500">{r.date}</span> —{" "}
                      <span className="tabular-nums">
                        {money(r.from)} → {money(r.to)}
                      </span>{" "}
                      <span className="tabular-nums text-red-400">
                        (−${r.abs.toLocaleString()}, −{r.pct.toFixed(1)}%)
                      </span>
                    </li>
                  ))}
                </ul>
                {hidden > 0 && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {hidden} older {hidden === 1 ? "reduction" : "reductions"} not shown
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-zinc-400">Price</dt>
        <dd className="tabular-nums">{deal.price != null ? money(deal.price) : "—"}</dd>
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
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
          aria-pressed={saved}
          onClick={() => setSaved(toggleShortlist(deal))}
        >
          {saved ? "Saved ✓" : "Add to shortlist"}
        </button>
      </div>
    </aside>
  );
}
