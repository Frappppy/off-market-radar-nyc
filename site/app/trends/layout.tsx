import type { Metadata } from "next";

// Gate fix — see app/map/layout.tsx for why these thin server layouts exist
// (client pages cannot export metadata, and all four routes shared one title and
// description). `alternates` is inherited from the root layout on purpose.
export const metadata: Metadata = {
  title: "Market trends — Off-Market Radar NYC",
  description:
    "Price-drop and days-on-market trends by ZIP, plus the High-motivation call list for the current filter.",
};

export default function TrendsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
