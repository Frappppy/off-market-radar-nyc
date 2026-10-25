// WHAT:   the header's data-freshness strip — "Data as of <date>", the frozen
//   pill when live:false, and (from lg up) the today's-scan / total / High /
//   source detail. "tracked today" names the newest daily cohort; the "in
//   total" figure beside it is the ever-seen ledger, so the daily number can
//   never be read as a database size.
// WHY:    the reader must know at a glance whether they see live Neon data or
//   the frozen fallback. The width/CLS reasoning (F6) is in the block below;
//   the wrapper in app/layout.tsx caps the box so no future string can reflow
//   the header row.
// INPUTS: /api/meta via hooks/useMeta (one fetch, no URL gate — this strip
//   never had one; a failure leaves meta null = the "Loading data…" state).
// OUTPUTS: one <span> line (or the loading placeholder).
// CALLERS: app/layout.tsx (header).
"use client";
import { useMeta } from "@/hooks/useMeta";
import { fmtCount } from "@/lib/market";

export default function Freshness() {
  // One fetch, no gate (this strip never had one). A first-load failure leaves
  // meta null, which is the same "Loading data…" state the old explicit
  // `setMeta(null)` catch produced — this effect never re-ran, so a failure
  // after a success could not occur.
  // Verified by: NOTHING (gap) — nothing replays the failure-after-success path.
  const { meta } = useMeta();
  if (!meta) return <span className="whitespace-nowrap text-xs text-zinc-500">Loading data…</span>;
  const date = meta.snapshot_date ?? "—";
  const frozen = !meta.live;
  return (
    <span className="whitespace-nowrap text-xs text-zinc-400" title={meta.run_id ?? ""}>
      {/* F6 — this box changes width three times (loading 78px, live 118px, and
          up to ~464px once the detail and the frozen pill are present), and
          every time it crosses the width left on the header's first row the flex
          container wraps it onto a second line and pushes <main> down 28px.
          Measured consequences, all in jobs/tier1-gate-fixes/evidence/gate-fixes.md §11:
            · 390, frozen  — 0.1466 CLS (the pill did not fit beside a 211px logo
              in 135px of room); fixed by folding the frozen state into one pill
              that carries the date, so the badge survives on /map, which has no
              IngestionHealth card to carry it instead.
            · 640–830, live — 0.3173 CLS, PRE-EXISTING (the deployed pre-fix build
              scores the same 0.31728) and never caught by the gate, whose CLS
              cells are 390/1280/1350. There the logo and nav leave ~183px, so the
              374px detail line always wrapped.
          The detail is therefore shown from lg up — 1024 is the first standard
          breakpoint above that band — which is the same "only where there is
          room" rule this span always had, with the threshold set by measurement.
          The wrapper in app/layout.tsx is additionally max-w-capped and
          truncated below lg, so no future string can reflow this row again.
          Verified by: NOTHING (gap) — the CLS measurements live in
          jobs/tier1-gate-fixes/evidence/gate-fixes.md §11; no runtime key
          re-measures this strip's width. */}
      <span className={frozen ? "sr-only lg:not-sr-only" : ""}>Data as of {date}</span>
      {frozen && (
        <span
          className="rounded bg-amber-100 px-1 text-amber-800 lg:hidden"
          title="frozen fallback — Neon unreachable"
        >
          Frozen · {date}
          <span className="sr-only"> (frozen fallback — Neon unreachable)</span>
        </span>
      )}
      {/* detail only where there is room; the hero repeats these numbers.
          "tracked today" names the cohort (the newest daily scan, which moves
          as homes sell or delist) and the total beside it is the ever-seen
          ledger, so a reader can never take the daily figure for a database
          size. Verified by: NOTHING (gap) — the lg threshold is
          measurement-set, not asserted at runtime. */}
      <span className="hidden lg:inline" title="Tracked today = listings in the newest daily scan · in total = every listing ever ingested (only grows)">
        {" · "}{meta.total_tracked != null ? fmtCount(meta.total_tracked) : "—"} tracked today
        {meta.total_ever_tracked != null ? ` · ${fmtCount(meta.total_ever_tracked)} in total` : ""}
        {" · "}{meta.high_count != null ? fmtCount(meta.high_count) : "—"} High · source {meta.source}
      </span>
      {frozen && (
        <span className="ml-1 hidden rounded bg-amber-100 px-1 text-amber-800 lg:inline">
          frozen fallback<span className="hidden lg:inline"> — Neon unreachable</span>
        </span>
      )}
    </span>
  );
}
