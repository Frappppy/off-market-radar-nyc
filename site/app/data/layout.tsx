// WHAT:   the thin server layout that gives /data its own title/description.
// WHY:    see app/map/layout.tsx (client pages cannot export metadata, and all
//   four routes shared one title and description). `alternates` is inherited
//   from the root layout on purpose.
// INPUTS: none — constants only.
// OUTPUTS: the `metadata` export Next merges, and a pass-through children.
// CALLERS: the Next.js router (via app/data/page.tsx).
// Verified by: NOTHING (gap) — Next's metadata merge (the shared-title
//   defect this layout fixes) is not runtime-checked.
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Call list & CSV export — Off-Market Radar NYC",
  description:
    "Every scored listing as a table: filter by motivation score, ZIP and days on market, then export the current rows as CSV.",
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
