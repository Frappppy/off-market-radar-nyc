"use client";
// WHAT:     the explorer route's dispatcher — one Suspense boundary that picks
//           the compact ("/" overview) or full ("/map") shell.
// WHY:      components/Explorer.tsx used to hold all three components (245
//           lines) — REFACTOR_PLAN §5 Phase 3 splits it into this file plus
//           CompactExplorer / FullExplorer. Behaviour is unchanged.
// INPUTS:   `compact` — true renders the mini overview shell.
// OUTPUTS:  whichever explorer shell matches, behind the Suspense fallback.
// CALLERS:  app/page.tsx (compact), app/map/page.tsx (full).

import { Suspense } from "react";
import CompactExplorer from "./CompactExplorer";
import FullExplorer from "./FullExplorer";

export default function Explorer({ compact = false }: { compact?: boolean }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">Loading explorer…</p>}>
      {compact ? <CompactExplorer /> : <FullExplorer />}
    </Suspense>
  );
}
