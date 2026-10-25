"use client";
// WHAT:     the ONE /api/meta request path — `useMeta(enabled)` returns
//           { meta }: the parsed payload, or null until it lands (and after a
//           first-load failure — a failure never overwrites a payload that
//           already arrived, and never fabricates one, which is exactly what
//           every inline effect did).
// WHY:      three hand-rolled effects (Freshness, HeroStats, Explorer) with
//           two guard styles and two with no guard at all — REPO_MAP §7.2.
//           Folding them into one hook left the real cost: /api/meta is
//           filter-INDEPENDENT, yet "/" mounted four consumers (the header's
//           Freshness, HeroStats, InsightCards and the compact Explorer), so
//           one landing page asked the same question four times — four Neon
//           round trips, four chances to fall back at different moments and
//           therefore four DIFFERENT totals on one screen. The response is now
//           shared through one module-level promise, so N consumers cost one
//           request and cannot disagree.
// INPUTS:   `enabled` (default true) — false fetches nothing; Explorer passes
//           the URL-store `ready` flag so the request starts when the inline
//           effect did. The payload is NOT validated or defaulted — every call
//           site reads fields straight off `meta`, as the inline code did.
// OUTPUTS:  { meta: Meta | null }. Consumers that mount after the answer
//           arrives get the cached payload immediately (no second request).
// CALLERS:  components/{Freshness, HeroStats, InsightCards, Explorer (total_
//           tracked only)}.
// Verified by: shots/phase3-runtime-gate.json → cancelledRequests — the re-run
//   abort half is asserted there; the shared-request count is NOT keyed (gap),
//   and neither is "failure never overwrites a payload".
//
// Deliberate difference from the inline code: /api/meta used to re-run inside
// Explorer's per-query effect. The payload is filter-independent, so this hook
// fetches once per enablement — same value, fewer requests. Once is now once
// per page load, not per consumer.

import { useEffect, useState } from "react";
import type { Meta } from "@/lib/api-types";

let cache: Meta | null = null;
let inflight: Promise<Meta> | null = null;

/** The one in-flight (or settled) load. An aborted request is not a failure
 *  mode here: nothing aborts the shared fetch, because a GET that several
 *  components wait on must finish for the others after one of them unmounts.
 *  A failure leaves `cache` untouched and clears `inflight`, so the next
 *  mount retries — the same "keep what arrived" rule the hook had per-mount. */
function loadMeta(): Promise<Meta> {
  if (inflight) return inflight;
  inflight = fetch("/api/meta")
    .then((r) => r.json())
    .then((m: Meta) => {
      cache = m;
      inflight = null;
      return m;
    })
    .catch((err: unknown) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function useMeta(enabled = true): { meta: Meta | null } {
  // Start from the shared payload: a consumer mounting after the answer
  // (Suspense-revealed explorer, late-hydrating card) renders real numbers on
  // its first paint instead of a second round trip of "…".
  const [meta, setMeta] = useState<Meta | null>(cache);

  useEffect(() => {
    if (!enabled) return;
    if (cache) {
      setMeta(cache);
      return;
    }
    let mine = true; // this consumer, not the request — the fetch continues
    loadMeta()
      .then((m) => {
        if (mine) setMeta(m);
      })
      .catch(() => {}); // keep what arrived; on a first load that is null
    return () => {
      mine = false;
    };
  }, [enabled]);

  return { meta };
}
