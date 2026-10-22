// WHAT:   /robots.txt (MetadataRoute.Robots) — allow everything except /api/.
// WHY:    gate fix — it 404'd on the deployed build, so nothing told crawlers
//   where the sitemap was or that /api/* is a data endpoint, not a page.
// INPUTS: SITE_ORIGIN (lib/site-config — same constant as metadataBase).
// OUTPUTS: the robots.txt body Next serves at /robots.txt.
// CALLERS: the Next.js router (app/robots.ts route).
import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-config";

// Gate fix — /robots.txt returned 404 on the deployed build (jobs/tier1-gate-fixes
// evidence, seo sweep). The origin is the same constant as `metadataBase` in
// app/layout.tsx — lib/site-config.ts (a route module's own EXPORTS are
// restricted by Next's allowlist, but imports are fine).
// Verified by: NOTHING (gap) — nothing fetches /robots.txt or /sitemap.xml at
//   runtime; the 404 fix rests on jobs/tier1-gate-fixes evidence.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
