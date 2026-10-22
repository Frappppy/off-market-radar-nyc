// WHAT:   /sitemap.xml — the four top routes plus one entry per fallback-CSV
//   listing id (the shareable /listing/[id] pages, D3).
// WHY:    gate fix — /sitemap.xml 404'd on the deployed build. Listing ids are
//   enumerable only from the frozen CSV at build time (no DATABASE_URL in the
//   build), so live-DB ids are deliberately absent; the long comment below is
//   the full reasoning and the swap path if the sitemap ever goes dynamic.
// INPUTS: SITE_ORIGIN (lib/site-config); public/data/listings_sample.csv via
//   lib/fallback.loadFallbackDeals (build time).
// OUTPUTS: MetadataRoute.Sitemap (pages + listings, one entry per
//   (source, listing_id) key).
// CALLERS: the Next.js router (app/sitemap.ts route).
import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-config";
import { loadFallbackDeals } from "@/lib/fallback";

// Gate fix — /sitemap.xml returned 404 (same sweep as app/robots.ts above).
// All four top routes are statically prerendered, so that list is the whole
// static site. Phase 3 adds the shareable /listing/[id] pages (D3): their ids
// are enumerable ONLY from the frozen fallback CSV — loadFallbackDeals() reads
// public/data/listings_sample.csv at build time, and no DATABASE_URL exists
// here, so live-DB listing ids are deliberately NOT in this file (they cannot
// be enumerated without a query at request time). They stay discoverable
// through the site itself: SideCard's "Open full page →" link on every map pin
// and /data row. If the sitemap is ever served dynamically with a live DB,
// swap loadFallbackDeals() for a `SELECT source, listing_id` and this file
// needs no other change.
// `lastModified` is the build time, which is honest here: the site's data
// changes on the daily ingest, not on a deploy, and claiming a data timestamp
// would be a stronger claim than this file can see.
// Verified by: NOTHING (gap) — neither the 404 fix, the frozen-CSV-only id
//   list, nor the build-time `lastModified` is a runtime-gate key.

const ROUTES: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" }> = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/map", priority: 0.8, changeFrequency: "daily" },
  { path: "/trends", priority: 0.7, changeFrequency: "daily" },
  { path: "/data", priority: 0.7, changeFrequency: "weekly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const pages: MetadataRoute.Sitemap = ROUTES.map((r) => ({
    url: `${SITE_ORIGIN}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // One entry per (source, listing_id) — the same key the history API and the
  // shortlist use (lib/dates.listingKey's shape, rebuilt here to avoid a
  // client-flavoured import in a build-time file). Priority sits below every
  // top route: a listing page is a leaf reached from a pin or a row, not a
  // navigation hub.
  // Verified by: NOTHING (gap) — no check counts sitemap entries or asserts
  //   the (source, listing_id) dedupe.
  const deals = await loadFallbackDeals();
  const seen = new Set<string>();
  const listings: MetadataRoute.Sitemap = [];
  for (const d of deals) {
    const k = `${d.source}:${d.listing_id}`;
    if (!d.listing_id || seen.has(k)) continue;
    seen.add(k);
    listings.push({
      url: `${SITE_ORIGIN}/listing/${encodeURIComponent(d.listing_id)}?source=${encodeURIComponent(d.source)}`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.4,
    });
  }

  return [...pages, ...listings];
}
