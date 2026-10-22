// WHAT:   the thin server layout that gives /map its own title/description.
// WHY:    see below (the gate fix); each route layout adds only its own
//   metadata, so the reasoning is explained exactly once, here.
// INPUTS: none — constants only.
// OUTPUTS: the `metadata` export Next merges, and a pass-through children.
// CALLERS: the Next.js router (via app/map/page.tsx).
import type { Metadata } from "next";

// Gate fix — all four routes shipped the root layout's title and description
// verbatim, so /map, /data and /trends were indistinguishable in a search
// result, a browser tab, or a shared link preview. The pages themselves are
// client components (they read the URL store and fetch on the client), and a
// `"use client"` module cannot export `metadata`, so each route gets a thin
// server layout that can.
//
// `alternates` is deliberately NOT set here: app/layout.tsx's `canonical: "./"`
// already resolves per route (verified on the deployed build), and repeating the
// value in four more places only creates four more things to keep in sync.
// Verified by: NOTHING (gap) — "verified on the deployed build" is jobs
//   evidence; no runtime-gate key reads a canonical/alternates tag.
export const metadata: Metadata = {
  title: "Map — Off-Market Radar NYC",
  description:
    "Every scored NYC listing on a map, clustered by ZIP. Click a pin for the deal card, the price history, and why it scored the way it did.",
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
