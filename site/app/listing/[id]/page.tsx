"use client";
// WHAT:     the standalone /listing/[id] shareable property page (D3) —
//           address h1, score chips, the key-stats panel, the daily
//           price-history block, the Zillow link, the shortlist toggle and a
//           link back to the explorer, with honest loading / error /
//           not-found states.
// WHY:      D3 — the SideCard is the quick look that opens from a pin or a
//           table row; this page is the linkable one. Everything it shows —
//           the current row and the daily series — now comes from the ONE
//           GET /api/listing/[id]?source=… request (hooks/useListingHistory),
//           which the route answers with a two-parameterised SQL read of
//           vw_latest_listings. It used to find the row by asking /api/deals
//           for the entire cohort (limit=5000, window_days=3650) and scanning
//           for its own id: every property page transferred the whole database
//           to render one listing.
// INPUTS:   route param `id` + optional `?source=` (the API is keyed on
//           (source, listing_id); default zillow); the history response's row,
//           series, dataset_latest_snapshot_date and `live` flag.
// OUTPUTS:  the rendered page — exactly one h1 (the address, or the id while
//           it is still loading or missing), h2 sections after it.
// CALLERS:  the Next.js router; linked from components/listings/SideCard
//           ("Open full page →"), which is what keeps the side panel as-is.
// Verified by: shots/phase3-runtime-gate.json → listing.h1Count (1) +
//   listing.headingSeq (["H1","H2","H2"]) — the OUTPUTS rule above.
import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import ScorePill from "@/components/listings/ScorePill";
import PriceHistoryBlock from "@/components/listings/PriceHistoryBlock";
import CohortSource from "@/components/status/CohortSource";
import { useListingHistory } from "@/hooks/useListingHistory";
import { useShortlist } from "@/lib/shortlist";
import { daysSince, isCarriedOver, lastSeenLabel } from "@/lib/dates";
import { fmtMoney, fmtPct } from "@/lib/format";

const backBtn =
  "inline-flex rounded border border-zinc-700 px-2 py-1 text-sm text-zinc-100 underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400";

function ListingInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const source = sp.get("source") ?? "zillow";

  const hist = useListingHistory(id, source);
  const deal = hist.deal;
  const { saved, toggle } = useShortlist(deal);

  // ---- states: loading | failed | not-found are three sentences ----
  // A shared link must not claim a result before there is one (the same
  // tri-state rule /data and /trends run on): loading, failed fetch, and
  // "loaded but no such id" are three different sentences.
  // The row and the series share this one request, so all three states are read
  // off `hist.status` — there is no second fetch that could still be pending.
  // Verified by: NOTHING (gap) — the gate exercises the loaded listing only.
  if (hist.status === "error") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Listing {id}</h1>
        <div className="panel p-4 text-sm text-zinc-400">Couldn&apos;t load listings — reload to try again.</div>
        <Link href="/map" className={backBtn}>← Back to the explorer</Link>
      </div>
    );
  }
  if (hist.status === "loading") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Listing {id}</h1>
        <div className="panel p-4 text-sm text-zinc-500">Loading listing…</div>
      </div>
    );
  }
  if (!deal) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Listing {id}</h1>
        <div className="panel space-y-1 p-4 text-sm text-zinc-400">
          <p>
            This listing isn&apos;t in the dataset — the id may be mistyped, or the listing aged out of
            the data we hold.
          </p>
          {/* "the dataset" means something different when the search fell back
              to the bundled sample: 82 rows, not the full ledger, so most ids
              legitimately miss. Say which one was searched.
              Verified by: NOTHING (gap) — no key forces live:false with an
              unknown id to read this line. */}
          <CohortSource live={hist.live} suffix="these results" />
        </div>
        <Link href="/map" className={backBtn}>← Back to the explorer</Link>
      </div>
    );
  }

  const addr = deal.address ?? deal.listing_id;
  const drop = deal.price_drop_pct != null ? fmtPct(deal.price_drop_pct) : "—";
  // Freshness reference: the newest snapshot in the dataset when the payload has
  // one, else this listing's own newest — data, never the browser clock, so the
  // label stays correct on a cached page or a wrong clock.
  // Verified by: TS — daysSince takes YYYY-MM-DD strings only (lib/dates.ts);
  //   no Date.now() input exists on this path.
  const age = daysSince(deal.snapshot_date, hist.datasetLatest ?? hist.latest);
  const lastSeen = lastSeenLabel(age);
  const carriedOver = isCarriedOver(age);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            Listing · {deal.source}{" "}
            {/* The numbers here and the price-history section below come from
                the SAME response, so one pill covers both: live:false means
                Neon did not answer and the bundled sample supplied the row (the
                series is then empty, and PriceHistoryBlock says so itself).
                Verified by: NOTHING (gap) — no key forces live:false to read
                the pill on a resolved listing. */}
            <CohortSource live={hist.live} suffix="these numbers" />
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold tracking-tight text-zinc-50">{addr}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <ScorePill score={deal.motivation_score} />
            <span>DOM {deal.days_on_market ?? "—"}</span>
            <span>drop {drop}</span>
            <span>{deal.property_type ?? "—"}</span>
            <span>{deal.zip ?? "—"}</span>
          </p>
        </div>
        <Link href="/map" className={backBtn}>← Back to the explorer</Link>
      </div>

      <section className="panel p-4">
        <h2 className="font-semibold text-zinc-100">The numbers</h2>
        <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
          <dt className="text-zinc-400">Price</dt>
          <dd className="tabular-nums">{deal.price != null ? fmtMoney(deal.price) : "—"}</dd>
          <dt className="text-zinc-400">$/sqft</dt>
          <dd className="tabular-nums">{deal.price_per_sqft != null ? `$${Number(deal.price_per_sqft).toFixed(0)}` : "—"}</dd>
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
          {carriedOver && <> — snapshot {deal.snapshot_date}, not in the newest daily run</>}
        </p>
      </section>

      <section className="panel p-4">
        <PriceHistoryBlock
          hist={hist}
          heading={<h2 className="font-semibold text-zinc-100">Price history</h2>}
          className="min-w-0"
        />
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        {deal.url && (
          <a className={backBtn} href={deal.url} target="_blank" rel="noreferrer">View on Zillow ↗</a>
        )}
        <button type="button" className={backBtn} aria-pressed={saved} onClick={toggle}>
          {saved ? "Saved ✓" : "Add to shortlist"}
        </button>
      </div>
    </div>
  );
}

export default function ListingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Loading listing…</p>}>
      <ListingInner />
    </Suspense>
  );
}
