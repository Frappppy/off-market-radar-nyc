import type { MetadataRoute } from "next";

// Gate fix — /robots.txt returned 404 on the deployed build (jobs/tier1-gate-fixes
// evidence, seo sweep), so nothing told crawlers where the sitemap was, or that
// /api/* is a data endpoint rather than a page. The origin is the same constant
// as `metadataBase` in app/layout.tsx; it is repeated rather than imported
// because a route module cannot read another module's metadata export.
const BASE = "https://off-market-radar-nyc.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
