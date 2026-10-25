// WHAT: the deployed site origin, in one place: an env override with the
//   project's Vercel origin as the fallback.
// WHY: it was hardcoded in four files — app/layout.tsx (metadataBase),
//   app/robots.ts, app/sitemap.ts and app/opengraph-image.tsx (display text)
//   — REFACTOR_PLAN §5 Phase 1. (robots.ts's old comment claimed a route
//   module could not import the constant; that was stale — only a route
//   module's own EXPORTS are restricted, imports are fine.) Collecting it into
//   one constant left a second problem: a custom domain, a preview deployment
//   or a local run still emitted absolute URLs for off-market-radar-nyc.
//   vercel.app, so robots.txt/sitemap.xml pointed crawlers somewhere other than
//   the site serving them.
// INPUTS: NEXT_PUBLIC_SITE_URL (authoritative, e.g. https://radar.example) —
//   else VERCEL_PROJECT_PRODUCTION_URL (a bare host, set on Vercel) — else the
//   historical default below. A bare host gets the https:// scheme added; a
//   trailing slash is stripped.
// OUTPUTS: SITE_ORIGIN — origin only, no trailing slash, no path, always
//   scheme-qualified (never a bare host, which `new URL()` rejects).
// CALLERS: app/{layout,robots,sitemap,opengraph-image}.
// Verified by: TS — the normaliser is total (string in, origin-shaped string
//   out); nothing boots the app with a custom env value to read it back (gap).

const DEFAULT_ORIGIN = "https://off-market-radar-nyc.vercel.app";

/** Trim to an origin: add the scheme a bare host needs, drop the trailing "/"
 *  the four call sites concatenate onto. */
const asOrigin = (raw: string): string => {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
};

const fromEnv =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";

export const SITE_ORIGIN = asOrigin(fromEnv.trim() || DEFAULT_ORIGIN);
