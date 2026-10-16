import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import Freshness from "@/components/Freshness";

export const metadata: Metadata = {
  title: "Off-Market Radar · NYC — Motivated Seller Finder",
  description:
    "Daily Zillow scrape of NYC listings scored for seller motivation. Map, trends, and CSV export for wholesalers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <Link href="/" className="order-1 shrink-0 whitespace-nowrap font-bold tracking-tight text-zinc-50">
              OFF-MARKET RADAR <span className="font-normal text-zinc-400">· NYC ▾</span>
            </Link>
            <nav className="order-3 flex w-full gap-4 text-sm text-zinc-300 sm:order-2 sm:w-auto sm:gap-3">
              <Link className="hover:underline" href="/">Overview</Link>
              <Link className="hover:underline" href="/map">Map</Link>
              <Link className="hover:underline" href="/trends">Trends</Link>
              <Link className="hover:underline" href="/data">Data</Link>
            </nav>
            <div className="order-2 ml-auto min-w-0 sm:order-3">
              <Freshness />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">{children}</main>
        <footer className="border-t border-zinc-800 bg-zinc-950 text-sm text-zinc-400">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-4">
            <div>
              <h3 className="font-semibold text-zinc-100">How it works</h3>
              <p>Daily scrape → motivation score → Postgres time-series → this map. Scraper never runs on page load; the site reads yesterday&apos;s snapshot.</p>
            </div>
            <div>
              <h3 className="font-semibold text-zinc-100">Motivation formula</h3>
              <p><b>High</b>: DOM &gt; 90 and drop &gt; 5%. <b>Medium</b>: either. <b>Low</b>: otherwise.</p>
            </div>
            <div>
              <h3 className="font-semibold text-zinc-100">Compliance</h3>
              <p>Zillow robots-allowed paths only, ≥2s pacing, CAPTCHA = abort. Realtor.com excluded (scraping disallowed). Demo sample — full details on Zillow. Production would use a licensed MLS feed.</p>
            </div>
            <div>
              <h3 className="font-semibold text-zinc-100">Links &amp; roadmap</h3>
              <p>
                <a className="underline" href="https://github.com">GitHub repo ↗</a> ·{" "}
                <a className="underline" href="/data">Power BI analyst deep-dive</a>
              </p>
              <p className="mt-1">V2 roadmap: login + saved searches + email alerts. Shortlist V1 lives in your browser only.</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
