import type { Metadata } from "next";

// Gate fix — see app/map/layout.tsx for why these thin server layouts exist
// (client pages cannot export metadata, and all four routes shared one title and
// description). `alternates` is inherited from the root layout on purpose.
export const metadata: Metadata = {
  title: "Call list & CSV export — Off-Market Radar NYC",
  description:
    "Every scored listing as a table: filter by motivation score, ZIP and days on market, then export the current rows as CSV.",
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
