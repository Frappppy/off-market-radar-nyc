"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
import { SCORE_COLORS, type Deal } from "@/lib/types";

// MapLibre + free Carto basemap (no token). Pins clustered client-side with
// supercluster; click cluster → zoom, click pin → onPick(deal).
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
        const el = document.createElement("div");
        if ((c.properties as { cluster?: boolean }).cluster) {
          const count = (c.properties as { point_count: number }).point_count;
          el.className = "maplibre-pin";
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
          const d = byId.get((c.properties as { id: string }).id);
          if (!d) continue;
          el.className = "maplibre-pin";
          el.style.background = SCORE_COLORS[d.motivation_score];
          el.title = `${d.address ?? d.listing_id} · ${d.motivation_score}`;
          el.onclick = () => pickRef.current(d);
        }
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
      }
    };
    map.on("load", render);
    map.on("moveend", render);
    const t = setInterval(render, 1500); // re-render when deals prop changes
    return () => {
      clearInterval(t);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={elRef} style={{ height, width: "100%", minHeight: 320 }} className="overflow-hidden rounded-xl border border-white/10" />;
}
