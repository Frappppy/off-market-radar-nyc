// WHAT:   the generated og:image (1200x630 PNG) for social/link previews.
// WHY:    S3 — a shared link rendered no preview card, which undercut roadmap
//   1.3's premise of sending a view to a colleague. Rendered from the project's
//   own title and colour tokens via next/og's ImageResponse: no new dependency
//   and no binary asset that can drift from the design. The long comment below
//   records which globals.css values are mirrored here and why.
// INPUTS: SCORE_COLORS (lib/scores), SITE_ORIGIN (lib/site-config); the
//   title/subtitle/blurb constants in this file.
// OUTPUTS: a PNG Response; the `alt`/`size`/`contentType` exports Next reads.
// CALLERS: the Next.js router (Next serves it at /opengraph-image).
import { ImageResponse } from "next/og";
import { SCORE_COLORS } from "@/lib/scores";
import { SITE_ORIGIN } from "@/lib/site-config";

// S3 — a shared link rendered no preview card, which undercut roadmap 1.3's
// whole premise of sending a view to a colleague. This generates the og:image
// from the project's own title/subtitle and the colour tokens in
// app/globals.css (:root), using the built-in next/og ImageResponse — no new
// dependency and no binary asset that can drift from the design.
// Verified by: NOTHING (gap) — nothing fetches /opengraph-image or asserts a
//   preview card renders for a shared link.
// ---- exports Next reads: alt / size / contentType ----
export const alt = "Off-Market Radar · NYC — Motivated Seller Finder";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ---- palette: mirrors of globals.css + lib/scores.ts SCORE_COLORS ----
// Mirrors app/globals.css: body #09090b, ink #f4f4f5, panel #141416. The three
// motivation hues come from lib/scores.ts (SCORE_COLORS), the single source that
// globals.css's --high/--medium/--low tokens mirror in CSS.
// Verified by: NOTHING (gap) — the CSS ↔ TS colour mirror has no drift check.
const INK = "#f4f4f5";
const MUTED = "#a1a1aa";
const BODY = "#09090b";

const TITLE = "Off-Market Radar · NYC";
const SUBTITLE = "Motivated Seller Finder";
const BLURB =
  "Daily Zillow scrape of NYC listings scored for seller motivation. Map, trends, and CSV export for wholesalers.";

const LEGEND: Array<{ label: string; colour: string }> = [
  { label: "High", colour: SCORE_COLORS.High },
  { label: "Medium", colour: SCORE_COLORS.Medium },
  { label: "Low", colour: SCORE_COLORS.Low },
];

// ---- ImageResponse markup (1200x630) ----
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BODY,
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {LEGEND.map((l) => (
            <div
              key={l.label}
              style={{
                width: 22,
                height: 22,
                borderRadius: 9999,
                background: l.colour,
              }}
            />
          ))}
          <div style={{ color: MUTED, fontSize: 26, letterSpacing: 6 }}>
            {TITLE.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ color: INK, fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>
            {SUBTITLE}
          </div>
          <div style={{ color: MUTED, fontSize: 32, lineHeight: 1.35, maxWidth: 940 }}>
            {BLURB}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #27272a",
            paddingTop: 28,
          }}
        >
          {LEGEND.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 9999,
                  background: l.colour,
                }}
              />
              <div style={{ color: INK, fontSize: 26 }}>{l.label}</div>
            </div>
          ))}
          <div style={{ color: MUTED, fontSize: 24 }}>{SITE_ORIGIN.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
