"use client";
// WHAT:     the lazy shell around the MapLibre map — `next/dynamic`,
//           client-only, with the box's height reserved by this wrapper.
// WHY:      maplibre-gl (~330 kB) + supercluster were imported statically by
//           both explorer shells, so the landing page shipped them inside
//           `First Load JS` (measured: / = 331 kB, /map = 329 kB against 102 kB
//           shared) even though the map is the last thing a reader sees and a
//           prerendered page cannot draw a canvas map at all (ssr:false is what
//           the component already effectively was — its map init runs in an
//           effect). Splitting it out moves the whole map stack into a chunk
//           fetched after first paint.
// INPUTS:   the same props as DealMap — `deals` (a new array triggers one
//           redraw), `onPick`, `height`.
// OUTPUTS:  a fixed-size box (exactly the height DealMap would have taken, so
//           the split cannot cause a layout shift) that DealMap fills once the
//           chunk lands.
// CALLERS:  components/explorer/{Full,Compact}Explorer.tsx.
// Verified by: NOTHING (gap) — no key counts /api requests or map chunks on
//   landing; the build's per-route First Load JS is the measurement.
import dynamic from "next/dynamic";
import type { Deal } from "@/lib/api-types";

// `ssr: false` — the map needs `document` and never rendered on the server
// anyway (its map is created inside an effect), so nothing about the output
// changes; only the bundle does.
const DealMapClient = dynamic(() => import("./DealMap"), { ssr: false });

export default function DealMapLazy({
  deals,
  onPick,
  height = 560,
}: {
  deals: Deal[];
  onPick: (d: Deal) => void;
  height?: number | string;
}) {
  // The wrapper owns the box, so the placeholder and the loaded map occupy the
  // same pixels — the chunk arriving cannot move anything.
  // Verified by: NOTHING (gap) — no key measures the box before/after load.
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10"
      style={{ height, width: "100%", minHeight: 320 }}
    >
      <DealMapClient deals={deals} onPick={onPick} height="100%" />
    </div>
  );
}
