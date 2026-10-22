// WHAT:   the thin server layout that gives /trends its own title/description.
// WHY:    see app/map/layout.tsx (client pages cannot export metadata, and all
//   four routes shared one title and description). `alternates` is inherited
//   from the root layout on purpose.
// INPUTS: none — constants only.
// OUTPUTS: the `metadata` export Next merges, and a pass-through children.
// CALLERS: the Next.js router (via app/trends/page.tsx).
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Market trends — Off-Market Radar NYC",
  description:
    "Price-drop and days-on-market trends by ZIP, plus the High-motivation call list for the current filter.",
};

export default function TrendsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
