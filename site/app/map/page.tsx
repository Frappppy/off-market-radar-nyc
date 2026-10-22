// WHAT:   /map page — the full Explorer (map + filters + side panel).
// WHY:    thin route wrapper: Explorer's default props ARE the map-first view.
// INPUTS: none directly; Explorer fetches via useDeals.
// OUTPUTS: the rendered map explorer.
// CALLERS: the Next.js router (app/map/page.tsx route).
import Explorer from "@/components/explorer/Explorer";

export default function MapPage() {
  return <Explorer />;
}
