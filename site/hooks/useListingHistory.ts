"use client";
// WHAT:     the ONE /api/listing/[id] request path —
//           `useListingHistory(listingId, source)` fetches one listing's daily
//           snapshot series AND its current row, and returns the tri-state the
//           surfaces render from: { status, points, latest, unavailable, deal,
//           datasetLatest, live }.
// WHY:      the effect lived inline in components/listings/SideCard.tsx; the
//           /listing/[id] page (REFACTOR_PLAN §5 Phase 3, D3) needs the same
//           series, so the abort-on-supersede convention moves here once —
//           same convention as hooks/useDeals.ts and hooks/useMeta.ts.
// INPUTS:   `listingId` and `source` (either null = fetch nothing and keep the
//           loading state; the card passes deal?.listing_id / deal?.source,
//           which are null while no pin is picked).
// OUTPUTS:  `status` loading|ready|error; `points` — the series, oldest first;
//           `latest` — the payload's latest_snapshot_date (null unless ready);
//           `unavailable` — the route answers 200 with `unavailable` when the
//           series could not be read (grant not applied / database unreachable):
//           no history, say so, do not chart nothing. `deal` — the listing's
//           current row from the same response (null when the id is not in the
//           dataset), `datasetLatest` — the dataset's newest snapshot, the
//           reference for "last seen"; both optional because an older payload
//           may not carry them.
//           `live` — the payload's own flag for the ROW (null until ready):
//           false means the bundled sample answered it, not the database.
// CALLERS:  components/listings/SideCard, app/listing/[id]/page.
//
// History is fetched per (source, listing_id), and the previous request is
// aborted when the target changes: rapid pin-to-pin clicking must not let an
// older response land on top of a newer pin's card.
// Verified by: shots/phase3-runtime-gate.json → cancelledRequests + notes
//   (abort-on-supersede); the `unavailable` rendering half is NOTHING (gap).

import { useEffect, useState } from "react";
import type { Deal, ListingHistoryPoint, ListingHistoryResponse } from "@/lib/api-types";

export interface ListingHistoryState {
  status: "loading" | "ready" | "error";
  points: ListingHistoryPoint[];
  latest: string | null;
  unavailable: boolean;
  deal: Deal | null;
  datasetLatest: string | null;
  live: boolean | null;
}

const LOADING: ListingHistoryState = {
  status: "loading",
  points: [],
  latest: null,
  unavailable: false,
  deal: null,
  datasetLatest: null,
  live: null,
};

export function useListingHistory(
  listingId: string | null,
  source: string | null
): ListingHistoryState {
  const [hist, setHist] = useState<ListingHistoryState>(LOADING);

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
          // The route's own flag, taken literally: it means "the series could
          // not be read". An empty-but-successful series is not `unavailable` —
          // with the row served from the bundled sample the old
          // `live === false && points.length === 0` conjuring labelled a real
          // address and price as "history view not granted", which is a
          // different (and wrong) sentence about a different half.
          unavailable: j.unavailable === true,
          deal: j.deal ?? null,
          datasetLatest: j.dataset_latest_snapshot_date ?? null,
          live: typeof j.live === "boolean" ? j.live : null,
        });
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setHist({ ...LOADING, status: "error" });
      });
    return () => ctrl.abort();
  }, [listingId, source]);

  return hist;
}
