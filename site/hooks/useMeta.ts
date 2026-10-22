"use client";
// WHAT:     the ONE /api/meta request path — `useMeta(enabled)` fetches
//           `/api/meta` and returns { meta }: the parsed payload, or null
//           until it lands (and after a first-load failure — a failure never
//           overwrites a payload that already arrived, and never fabricates
//           one, which is exactly what every inline effect did).
// WHY:      three hand-rolled effects (Freshness, HeroStats, Explorer) with
//           two guard styles and two with no guard at all — REPO_MAP §7.2.
//           Same AbortController convention as hooks/useDeals.ts: re-run or
//           unmount aborts the in-flight request, so a late response cannot
//           write state after its consumer is gone.
// INPUTS:   `enabled` (default true) — false fetches nothing; Explorer passes
//           the URL-store `ready` flag so the request starts when the inline
//           effect did. The payload is NOT validated or defaulted — every call
//           site reads fields straight off `meta`, as the inline code did.
// OUTPUTS:  { meta: Meta | null }.
// CALLERS:  components/{Freshness, HeroStats, Explorer (total_tracked only)}.
// Verified by: shots/phase3-runtime-gate.json → cancelledRequests — re-run and
//   unmount aborts are asserted; the "failure never overwrites a payload"
//   half is NOTHING (gap).
//
// Deliberate difference from the inline code: /api/meta used to re-run inside
// Explorer's per-query effect. The payload is filter-independent, so this hook
// fetches once per enablement — same value, fewer requests.

import { useEffect, useState } from "react";
import type { Meta } from "@/lib/api-types";

export function useMeta(enabled = true): { meta: Meta | null } {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetch("/api/meta", { signal: ac.signal })
      .then((r) => r.json())
      .then((m: Meta) => {
        if (!ac.signal.aborted) setMeta(m);
      })
      .catch(() => {}); // keep what arrived; on a first load that is null
    return () => ac.abort();
  }, [enabled]);

  return { meta };
}
