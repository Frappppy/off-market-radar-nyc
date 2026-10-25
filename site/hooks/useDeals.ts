"use client";
// WHAT:     the ONE /api/deals request path — `useDeals(query, options)` fetches
//           `/api/deals?${query}` and returns the state the explorer pages
//           render from: { deals, latestSnapshotDate, loaded, loadError, live }.
// WHY:      five hand-rolled effects (Explorer x2, /data, /trends, HeroStats)
//           with TWO stale-response guards (`dead` flags vs AbortController)
//           and one with no guard at all — REPO_MAP §7.2. The bug class is a
//           slow response landing after a newer query and overwriting it (the
//           incident behind lib/useUrlSearch's `ready` gate and the
//           1.5s-poll note in components/DealMap.tsx). One convention lives
//           here: every re-run and every unmount aborts the in-flight request,
//           so a stale response can never write state.
// INPUTS:   `query` — everything after the `?` (lib/useFilters.toDealsQuery or
//           a literal); a different string re-fetches. `options.enabled`
//           (default true) — while false NOTHING runs: no request and no
//           loading-state reset; three call sites pass the URL-store `ready`
//           flag so the first fetch waits for the reader's own query string
//           instead of spending a request on the SSR placeholder cohort.
//           `options.onSuccess(response)` — runs in the success tick, batched
//           with this hook's update, for call-site side effects that must land
//           in the same render (Explorer's last-good snapshot copy, /data
//           closing its open row panel).
// OUTPUTS:  `deals` — rows, reset to [] by a settled failure. `loaded` — false
//           while a request is in flight (re-set on every query change), true
//           once it settles; `loadError` marks a settled failure. Both exist
//           because "0 listings shown" is a CLAIM about the data, not a
//           loading state (measured 150–350 ms flash on /trends; "no listings
//           match" for 1–2.5 s on /data — the incidents live at those call
//           sites). `latestSnapshotDate` — the payload's latest_snapshot_date,
//           CLEARED by a failure: /data's rule is "a failed fetch is not a
//           known date". Explorer wants the opposite (an open card keeps
//           ageing rows against the last good date), so it keeps its own copy
//           fed by onSuccess — the two call sites genuinely disagreed and this
//           hook takes the stricter rule.
//           `live` — the payload's own `live` flag: true = these rows came from
//           Neon, false = the frozen CSV fallback answered THIS request, null =
//           not settled yet (or the server said nothing). It is the cohort's
//           provenance and it is NOT the same fact as the header pill's
//           `meta.live`: /api/meta and /api/deals are separate requests, so one
//           can fall back while the other answers live. A page that shows a
//           cohort count has to say which dataset it counted.
// CALLERS:  components/{Explorer (compact + full), HeroStats}, app/{data, trends}.
// Verified by: shots/phase3-runtime-gate.json → cancelledRequests + notes —
//   abort-on-supersede is asserted; the "failure clears latestSnapshotDate"
//   half is NOTHING (gap).

import { useEffect, useRef, useState } from "react";
import type { Deal, DealsResponse } from "@/lib/api-types";

export interface UseDealsOptions {
  /** false = fetch nothing and touch no state (the URL-store `ready` gate). */
  enabled?: boolean;
  /** Runs in the success tick, batched with this hook's state update. */
  onSuccess?: (response: DealsResponse) => void;
}

export function useDeals(
  query: string,
  options?: UseDealsOptions
): {
  deals: Deal[];
  latestSnapshotDate: string | null;
  loaded: boolean;
  loadError: boolean;
  live: boolean | null;
} {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [latestSnapshotDate, setLatestSnapshotDate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // null until a response says otherwise: "live" is as much a claim as a row
  // count, and before the first response there is nothing to claim.
  const [live, setLive] = useState<boolean | null>(null);

  const enabled = options?.enabled ?? true;
  // Read through a ref so an inline call-site options object never becomes a
  // reason to re-run the fetch effect.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!enabled) return;
    // Back to "loading" on every query change: the old cohort answers the old
    // question and must not be shown as if it answered the new one.
    setLoaded(false);
    setLoadError(false);
    setLive(null);
    const ac = new AbortController();
    fetch(`/api/deals?${query}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j: DealsResponse) => {
        if (ac.signal.aborted) return;
        // Read `j.deals` before anything else: a non-object payload must throw
        // into the failure path (as the inline code did) BEFORE onSuccess runs,
        // so a call site never sees a "success" side effect for a bad body.
        const rows = j.deals ?? [];
        setDeals(rows);
        setLatestSnapshotDate(j.latest_snapshot_date ?? null);
        setLive(typeof j.live === "boolean" ? j.live : null);
        setLoaded(true);
        optionsRef.current?.onSuccess?.(j);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setDeals([]);
        setLatestSnapshotDate(null); // a failed fetch is not a known date
        setLive(null); // ...and not a known dataset either
        setLoadError(true);
        setLoaded(true);
      });
    return () => ac.abort();
  }, [enabled, query]);

  return { deals, latestSnapshotDate, loaded, loadError, live };
}
