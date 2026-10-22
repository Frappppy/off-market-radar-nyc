"use client";
// WHAT:     the ONE /api/listing/[id] request path —
//           `useListingHistory(listingId, source)` fetches one listing's daily
//           snapshot series and returns the tri-state the surfaces render
//           from: { status, points, latest, unavailable }.
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
//           history view is not readable (grant not applied / Neon asleep), and
//           live=false with no rows is the same story: no history, say so, do
//           not chart nothing.
// CALLERS:  components/listings/SideCard, app/listing/[id]/page.
//
// History is fetched per (source, listing_id), and the previous request is
// aborted when the target changes: rapid pin-to-pin clicking must not let an
// older response land on top of a newer pin's card.
// Verified by: shots/phase3-runtime-gate.json → cancelledRequests + notes
//   (abort-on-supersede); the `unavailable` rendering half is NOTHING (gap).

import { useEffect, useState } from "react";
import type { ListingHistoryPoint, ListingHistoryResponse } from "@/lib/api-types";

export interface ListingHistoryState {
  status: "loading" | "ready" | "error";
  points: ListingHistoryPoint[];
  latest: string | null;
  unavailable: boolean;
}

const LOADING: ListingHistoryState = {
  status: "loading",
  points: [],
  latest: null,
  unavailable: false,
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
          unavailable: j.unavailable === true || (j.live === false && points.length === 0),
        });
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setHist({ status: "error", points: [], latest: null, unavailable: false });
      });
    return () => ctrl.abort();
  }, [listingId, source]);

  return hist;
}
