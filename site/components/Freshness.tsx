"use client";
import { useEffect, useState } from "react";
import { fmtCount } from "@/lib/market";
import type { Meta } from "@/lib/types";

export default function Freshness() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);
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
          truncated below lg, so no future string can reflow this row again. */}
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
      {/* detail only where there is room; the hero repeats these numbers */}
      <span className="hidden lg:inline">
        {" · "}{meta.total_tracked != null ? fmtCount(meta.total_tracked) : "—"} tracked (sample) · {meta.high_count != null ? fmtCount(meta.high_count) : "—"} High · source {meta.source}
      </span>
      {frozen && (
        <span className="ml-1 hidden rounded bg-amber-100 px-1 text-amber-800 lg:inline">
          frozen fallback<span className="hidden lg:inline"> — Neon unreachable</span>
        </span>
      )}
    </span>
  );
}
