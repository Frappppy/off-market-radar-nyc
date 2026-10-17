import type { MetadataRoute } from "next";

// Gate fix — /sitemap.xml returned 404 (same sweep as app/robots.ts above).
// All four routes are statically prerendered, so this list is the whole site and
// there is nothing dynamic to enumerate. `lastModified` is the build time, which
// is honest here: the site's data changes on the daily ingest, not on a deploy,
// and claiming a data timestamp would be a stronger claim than this file can see.
const BASE = "https://off-market-radar-nyc.vercel.app";

const ROUTES: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" }> = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/map", priority: 0.8, changeFrequency: "daily" },
  { path: "/trends", priority: 0.7, changeFrequency: "daily" },
  { path: "/data", priority: 0.7, changeFrequency: "weekly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((r) => ({
    url: `${BASE}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
