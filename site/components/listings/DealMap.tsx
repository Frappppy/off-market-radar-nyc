// WHAT:   the MapLibre map — clustered, score-coloured pins over a free Carto
//   basemap (no token). Click cluster → zoom; click pin → onPick(deal).
// WHY:    pins are keyboard-operable buttons, not clickable divs (S1): role,
//   tabindex, Enter/Space and a per-pin accessible name, because maplibre's
//   default aria-label was the identical "Map marker" on all 34 markers. The
//   redraw is a `useEffect` keyed on `deals` (F6) because the old 1.5s
//   interval rebuilt every marker ~40x a minute while idle and detached
//   whatever marker a click was landing on. Inline comments carry the measured
//   reasons (control position, a11y wiring order).
// INPUTS: `deals` (a new array triggers one redraw), `onPick`, `height`.
// OUTPUTS: the bare map container div (the bordered, height-reserving box is
//   the lazy shell's job). Marker DOM is managed internally via refs.
// CALLERS: components/listings/DealMapLazy.tsx — the ONLY importer, so
//   maplibre stays out of the explorer pages' initial bundle.
"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
import { SCORE_COLORS } from "@/lib/scores";
import type { Deal } from "@/lib/api-types";

// ---- marker helpers: per-pin labels + keyboard activation ----
// MapLibre + free Carto basemap (no token). Pins clustered client-side with
// supercluster; click cluster → zoom, click pin → onPick(deal).
//
// S1 — the pins are keyboard-operable buttons, not clickable divs: role=button,
// tabindex=0 and an Enter/Space handler, plus a specific accessible name
// ("<address> · High motivation · DOM 134") instead of maplibre's default
// aria-label="Map marker", which was the identical string on all 34 markers.
// Focusability forced a second fix: a redraw that destroys and rebuilds every
// marker drops focus to <body> mid-tab, so the redraw must be driven by a
// genuinely new `deals` array and nothing else.
// Verified by: NOTHING (gap) — map.markers only counts rendered markers; no
//   key tab-walks a pin, reads its name, or catches focus dropping to <body>.
// F6 — that used to be a 1.5s `setInterval` that *checked* for a new array,
// which still tore down and rebuilt the whole marker set plus a fresh
// Supercluster index ~40 times a minute while the map sat idle, and detached
// whatever marker a click was landing on. It is now a `useEffect` keyed on
// `deals`, so an idle map does no work at all.
// Verified by: NOTHING (gap) — no key measures the ~40x/min rebuild rate or
//   the detached-click failure the 1.5s interval caused.
const markerLabel = (d: Deal) =>
  `${d.address ?? d.listing_id} · ${d.motivation_score} motivation · DOM ${
    d.days_on_market ?? "unknown"
  }`;

// Enter and Space are the two keys that activate a button. Space is " ", never
// "Spacebar" (that name is legacy IE/Edge only).
// Verified by: NOTHING (gap) — no runtime check drives Enter/Space on a pin
//   (data_panel.openedByEnter covers table rows, not markers).
const activate = (el: HTMLElement, run: () => void) => {
  el.onkeydown = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault(); // Space would otherwise scroll the page
      run();
    }
  };
};

// ---- component: init (control placement) | render loop | redraw ----
export default function DealMap({
  deals,
  onPick,
  height = 560,
}: {
  deals: Deal[];
  onPick: (d: Deal) => void;
  height?: number | string;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const dealsRef = useRef(deals);
  dealsRef.current = deals;
  // F6 — `renderRef` lets the `deals` effect below reach the render closure
  // that was created with the map; `readyRef` stops a redraw before the style
  // has loaded (the `load` handler draws whatever is current by then).
  const renderRef = useRef<(() => void) | null>(null);
  const readyRef = useRef(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: elRef.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [-73.98, 40.72], // NYC
      zoom: 10,
    });
    // top-left, not top-right: the detail panel (roadmap 1.2) floats over the
    // map's top-right corner, and maplibre gives its control container
    // `z-index: 2`. At top-right the zoom buttons sat on top of the panel's
    // Close button and stole the last ~15px of its click target (measured:
    // elementFromPoint at the button's right edge returned
    // .maplibregl-ctrl-icon). The panel overlay now also sets z-10, and this
    // keeps the control out from under the card at desktop widths so both stay
    // usable. Top-left is empty; the legend is bottom-left and attribution
    // stays bottom-right.
    // Verified by: NOTHING (gap) — the elementFromPoint / ~15px measurement
    //   is gate-fix evidence; no key checks the control-vs-Close overlap.
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    mapRef.current = map;

    const render = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      const rows = dealsRef.current.filter((d) => d.latitude != null && d.longitude != null);
      const index = new Supercluster({ radius: 48, maxZoom: 16 });
      index.load(
        rows.map((d) => ({
          type: "Feature" as const,
          properties: { id: d.listing_id },
          geometry: { type: "Point" as const, coordinates: [d.longitude as number, d.latitude as number] },
        }))
      );
      const b = map.getBounds();
      const clusters = index.getClusters(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        Math.round(map.getZoom())
      );
      const byId = new Map(rows.map((d) => [d.listing_id, d]));
      for (const c of clusters) {
        const [lng, lat] = c.geometry.coordinates;
        const isCluster = (c.properties as { cluster?: boolean }).cluster === true;
        const count = (c.properties as { point_count?: number }).point_count ?? 0;
        const deal = isCluster ? undefined : byId.get((c.properties as { id: string }).id);
        if (!isCluster && !deal) continue;
        const el = document.createElement("div");
        el.className = "maplibre-pin";
        if (isCluster) {
          el.style.width = "28px";
          el.style.height = "28px";
          el.style.background = "#2563eb";
          el.style.color = "#fff";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.fontSize = "12px";
          el.textContent = String(count);
          el.onclick = () => {
            map.easeTo({ center: [lng, lat], zoom: map.getZoom() + 2 });
          };
        } else {
          el.style.background = SCORE_COLORS[deal!.motivation_score];
          el.title = `${deal!.address ?? deal!.listing_id} · ${deal!.motivation_score}`;
          el.onclick = () => pickRef.current(deal!);
        }
        // maplibre stamps aria-label="Map marker" on the marker element, so the
        // accessible name and keyboard wiring go on AFTER it is constructed and
        // attached — otherwise they are overwritten.
        // Verified by: NOTHING (gap) — no key reads a marker's aria-label
        //   after maplibre has attached it.
        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        markersRef.current.push(marker);
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        if (isCluster) {
          el.setAttribute("aria-label", `Zoom in on ${count} listings`);
          activate(el, () => map.easeTo({ center: [lng, lat], zoom: map.getZoom() + 2 }));
        } else {
          el.setAttribute("aria-label", markerLabel(deal!));
          activate(el, () => pickRef.current(deal!));
        }
      }
    };
    renderRef.current = render;
    map.on("load", () => {
      readyRef.current = true;
      render();
    });
    map.on("moveend", render);
    return () => {
      renderRef.current = null;
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // F6 — the redraw trigger: a new `deals` array, and nothing else. The `load`
  // handler above draws whatever is current when the style arrives, so this
  // effect is a no-op until the map is ready.
  // Verified by: shots/phase3-runtime-gate.json → map.markers (7 markers
  //   rendered on /map); the "and nothing else" trigger half is a gap.
  useEffect(() => {
    if (readyRef.current) renderRef.current?.();
  }, [deals]);

  // The visible box (border, radius, fixed height) belongs to
  // components/listings/DealMapLazy.tsx — this div fills whatever it is given,
  // so the lazy shell reserves the pixels and nothing shifts when the chunk
  // arrives. maplibre needs a sized container, which `height` is (100% of that
  // shell in practice).
  // Verified by: NOTHING (gap) — no key measures the box before/after load.
  return <div ref={elRef} style={{ height, width: "100%", minHeight: 320 }} />;
}
