import { ImageResponse } from "next/og";

// S3 — a shared link rendered no preview card, which undercut roadmap 1.3's
// whole premise of sending a view to a colleague. This generates the og:image
// from the project's own title/subtitle and the colour tokens in
// app/globals.css (:root), using the built-in next/og ImageResponse — no new
// dependency and no binary asset that can drift from the design.
export const alt = "Off-Market Radar · NYC — Motivated Seller Finder";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Mirrors app/globals.css: body #09090b, ink #f4f4f5, panel #141416, and the
// three motivation tokens --high / --medium / --low.
const INK = "#f4f4f5";
const MUTED = "#a1a1aa";
const BODY = "#09090b";
const HIGH = "#d62728";
const MEDIUM = "#e6a817";
const LOW = "#9aa0a6";

const TITLE = "Off-Market Radar · NYC";
const SUBTITLE = "Motivated Seller Finder";
const BLURB =
  "Daily Zillow scrape of NYC listings scored for seller motivation. Map, trends, and CSV export for wholesalers.";

const LEGEND: Array<{ label: string; colour: string }> = [
  { label: "High", colour: HIGH },
  { label: "Medium", colour: MEDIUM },
  { label: "Low", colour: LOW },
];

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
          <div style={{ color: MUTED, fontSize: 24 }}>off-market-radar-nyc.vercel.app</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
