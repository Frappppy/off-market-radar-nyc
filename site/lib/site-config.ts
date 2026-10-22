// WHAT: the deployed site origin, in one place.
// WHY: it was hardcoded in four files — app/layout.tsx (metadataBase),
//   app/robots.ts, app/sitemap.ts and app/opengraph-image.tsx (display text)
//   — REFACTOR_PLAN §5 Phase 1. (robots.ts's old comment claimed a route
//   module could not import the constant; that was stale — only a route
//   module's own EXPORTS are restricted, imports are fine.)
// INPUTS: none — a settled constant, deliberately not an env lookup.
// Verified by: TS — a literal module const; no runtime path can rewrite it.
// OUTPUTS: SITE_ORIGIN — origin only, no trailing slash, no path.
// CALLERS: app/{layout,robots,sitemap,opengraph-image}.

export const SITE_ORIGIN = "https://off-market-radar-nyc.vercel.app";
