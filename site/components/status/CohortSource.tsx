"use client";
// WHAT:     one inline pill that names the dataset a COHORT was answered from:
//           "frozen fallback" when /api/deals (or /api/zips) said live:false.
// WHY:      the header's Freshness strip and the IngestionHealth card both read
//           /api/meta, and /api/meta is a separate request from the one that
//           produced the rows on screen. Neon can answer the meta query live
//           and fail the cohort query a second later (or the other way round),
//           which left every cohort number on /data, /trends and /map looking
//           live while it was counted from public/data/listings_sample.csv.
//           The claim has to sit with the number, not with a global pill.
// INPUTS:   `live` — the payload's own flag from hooks/useDeals or an API
//           response: true = Neon answered, false = the bundled sample did,
//           null = not settled yet (renders nothing; there is nothing to say).
//           `suffix` — a PLURAL noun phrase naming what is on screen ("these
//           pins", "the rows and the CSV"): the sentence is built with the fixed
//           verb "come", so a singular suffix reads "this search come from…".
//           The /listing/[id] not-found panel hit exactly that, until the suffix
//           became a documented plural phrase.
//           Verified by: NOTHING (gap) — no key renders the pill per caller and
//           reads the sentence it builds.
// OUTPUTS:  an inline <span> (nothing unless live === false), so it can be
//           dropped into a paragraph that already exists in every state and
//           cannot reflow the layout by appearing.
// CALLERS:  app/data/export-header.tsx, app/trends/page.tsx,
//           app/listing/[id]/page.tsx,
//           components/explorer/{Full,Compact}Explorer.tsx.
// Verified by: NOTHING (gap) — no key forces a live:false cohort response to
//   assert the pill appears beside the numbers it qualifies.

export default function CohortSource({ live, suffix = "these figures" }: {
  live: boolean | null;
  suffix?: string;
}) {
  if (live !== false) return null;
  return (
    <span
      className="rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800"
      title="Neon did not answer this request — the sample bundled with the site did"
    >
      frozen fallback<span className="hidden sm:inline"> — {suffix} come from the bundled sample</span>
    </span>
  );
}
