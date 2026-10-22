// WHAT:     the thin server layout for /listing/[id] — dynamic generateMetadata
//           (title names the listing id) + passthrough children.
// WHY:      client pages cannot export metadata, and a single shared title for
//           every /listing/* is the exact defect the other thin layouts fixed;
//           D3 asks for a shareable page, so its link preview must name the
//           property. No DB and no fallback-CSV read here (REFACTOR_PLAN §5
//           Phase 3): the server cannot know the address without a query, so
//           the id is the honest server-side name and the client page renders
//           the real h1.
// INPUTS:   route params — { id }.
// OUTPUTS:  Metadata { title, description } + the passthrough wrapper.
// CALLERS:  the Next.js router for app/listing/[id]/page.tsx.

import type { Metadata } from "next";

// `generateMetadata`, not `export const metadata`: the title needs params —
// and it reads NOTHING else: no DB, no fallback CSV.
// Verified by: TS — this module imports only `next/*` types (no lib/db, no
//   lib/fallback), so the no-DB/no-CSV rule is structural.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Listing ${id} — Off-Market Radar NYC`,
    description:
      "Shareable property page for one listing: motivation score, price, days on market and the daily price-history series.",
  };
}

export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
