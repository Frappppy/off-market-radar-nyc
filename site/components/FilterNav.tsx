"use client";
import Link from "next/link";
import { useUrlSearch } from "@/lib/useUrlSearch";

// The /trends copy says "Reflects the current map filters" — but a plain
// <Link href="/trends"> drops the query string, so a reader who filtered on
// /map or /data and clicked "Trends" silently landed on the DEFAULT cohort
// (133 rows) while believing their filter had followed them. The independent
// QA gate measured exactly that and called it a copy/behaviour mismatch.
//
// The fix is to keep the promise: the three explorer routes carry whatever
// query the reader currently has. "/" (the overview) is not filter-aware, so
// it stays bare. The store's server snapshot is "" so SSR and the hydration
// render emit the same bare hrefs the server prerendered; the live query is
// folded in on the first commit, which changes only the `href`, never the
// link text — so this cannot shift layout.
export default function FilterNav() {
  const q = useUrlSearch();
  const search = q.toString();
  const withQuery = (path: string) => (search ? `${path}?${search}` : path);

  return (
    <nav className="order-3 flex w-full gap-4 text-sm text-zinc-300 sm:order-2 sm:w-auto sm:gap-3">
      <Link className="tap hover:underline" href="/">Overview</Link>
      <Link className="tap hover:underline" href={withQuery("/map")}>Map</Link>
      <Link className="tap hover:underline" href={withQuery("/trends")}>Trends</Link>
      <Link className="tap hover:underline" href={withQuery("/data")}>Data</Link>
    </nav>
  );
}
