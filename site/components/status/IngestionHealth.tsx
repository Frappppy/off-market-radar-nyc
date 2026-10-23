// WHAT:   the ingestion-health card — last successful/failed run, next
//   scheduled run, 30-day tallies, history depth and sample coverage, in a
//   five-cell grid (roadmap 1.4).
// WHY:    Coverage is a SAMPLE against a disclosure denominator (lib/market),
//   never a full-coverage claim. (The "why is there a hole in the chart?"
//   rationale lives with GET /api/health; F5 geometry is annotated below.)
// INPUTS: /api/health via its own fetch (the Health payload — a different
//   endpoint than the useDeals/useMeta pair covers); CRON_SCHEDULE and
//   MARKET_REFERENCE constants.
// OUTPUTS: the <section> card; a "run history unavailable" pill on fetch error.
// CALLERS: app/data/page.tsx, app/trends/page.tsx.
// Coverage is always a SAMPLE, never full-coverage. Verified by: NOTHING (gap).
"use client";
import { useEffect, useState } from "react";
import { CRON_SCHEDULE } from "@/lib/cron";
import { fmtCount, marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";
import { fmtPct } from "@/lib/format";
import type { Health } from "@/lib/api-types";

// Fixed locale, explicit UTC zone (the cron is 10:00 UTC); the year is omitted
// (it does not fit a phone-width cell); raw ISO always in the `title`.
// Verified by: NOTHING (gap) — no key asserts this UTC date rendering.
const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** ISO 8601 → `"Oct 16, 06:07 UTC"`, or null when absent/unparseable. */
function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${WHEN.format(new Date(t))} UTC` : null;
}

interface Row {
  label: string;
  value: string;
  note: string;
  title?: string;
}

// No `className` prop (REPO_MAP §8.2).
// ---- five-cell model → fixed-geometry section (F5) ----
export default function IngestionHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    // Verified by: NOTHING (gap) — house-guard AbortController here, but nothing aborts this fetch.
    const ac = new AbortController();
    fetch("/api/health", { signal: ac.signal })
      .then((r) => r.json())
      .then((j: Health) => setHealth(j))
      .catch(() => {
        if (!ac.signal.aborted) setUnavailable(true);
      });
    return () => ac.abort();
  }, []);

  const loading = health === null && !unavailable;
  const live = health?.live ?? null;
  const lastOk = health?.last_success ?? null;
  const lastFail = health?.last_failure ?? null;
  const records = lastOk?.records_loaded ?? null;
  const finished = fmtWhen(lastOk?.finished_at);
  const next = fmtWhen(health?.next_run_at);
  const tracked = health?.tracked ?? null;
  const totalEver = health?.total_ever_tracked ?? null;
  const pct = health?.coverage_pct ?? null;
  const ok = health?.runs_ok_30d ?? null;
  const failed = health?.runs_failed_30d ?? null;
  const days = health?.snapshot_days ?? null;
  const latest = health?.latest_snapshot_date ?? null;

  const rows: Row[] = [
    {
      label: "Last successful run",
      value: loading ? "…" : (finished ?? "—"),
      note: unavailable
        ? "status unavailable"
        : loading
          ? "reading pipeline_runs…"
          : records != null
            ? `${fmtCount(records)} rows loaded`
            : "no successful run on record",
      title: lastOk?.finished_at ?? undefined,
    },
    {
      label: "Next scheduled run",
      value: loading ? "…" : (next ?? "—"),
      note: loading ? "reading the cron schedule…" : `cron ${CRON_SCHEDULE} UTC`,
      title: health?.next_run_at
        ? `Next run ${health.next_run_at} · cron ${CRON_SCHEDULE} (UTC)${lastOk?.run_id ? ` · last run id ${lastOk.run_id}` : ""}`
        : `cron ${CRON_SCHEDULE} (UTC)`,
    },
    {
      label: "Today's scan (sample)",
      value: loading ? "…" : tracked != null ? `${fmtCount(tracked)} of ${marketSizeLabel}` : "—",
      note: loading
        ? "counting the newest snapshot…"
        : pct != null
          ? `${fmtPct(pct)} of ${MARKET_REFERENCE.label} — a sample${totalEver != null ? ` · ${fmtCount(totalEver)} in total` : ""}`
          : "sample size unknown",
      title: `The newest day's scan only — homes sell or delist, so this number moves daily. Disclosure denominator: ${fmtCount(MARKET_REFERENCE.listings)} ${MARKET_REFERENCE.label} as of ${MARKET_REFERENCE.as_of} — our ingestion is capped on purpose, so this is a slice of the market`,
    },
    {
      label: "Runs · last 30 days",
      value: loading ? "…" : `${ok ?? "—"} ok / ${failed ?? "—"} failed`,
      note: loading
        ? "reading pipeline_runs…"
        : lastFail
          ? `last failure ${lastFail.run_id}`
          : ok != null || failed != null
            ? "no failed runs in the window"
            : "tallies need the database",
      title: lastFail?.notes ?? undefined,
    },
    {
      label: "History depth",
      value: loading ? "…" : days != null ? `${fmtCount(days)} daily snapshots` : "—",
      note: unavailable
        ? "history depth unknown"
        : loading
          ? "counting snapshot dates…"
          : days != null
            ? "lengthens with each successful run"
            : "unknown in the frozen sample",
      title: latest ? `Newest snapshot_date in vw_latest_listings: ${latest}` : undefined,
    },
  ];

  return (
    <section
      // F5 — this card always claimed a fixed shape but measured 357px
      // (loading and live) and 377px (live === false, where the frozen badge
      // wraps the header row onto a second line) at 390. 377 is the real
      // worst-case geometry, so the card is born at it on a phone and at its
      // real 156px height from 640px up. Only the live === false path was
      // taller, and it is unreachable while /api/health reports live, so this
      // changes nothing in the 12 measured cells.
      // Verified by: NOTHING (gap) — no key pins this 377px/156px geometry.
      className="panel p-3 min-h-[377px] sm:min-h-[156px]"
      aria-labelledby="ingestion-health-heading"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="ingestion-health-heading" className="eyebrow">
          Ingestion · daily run
        </h2>
        {live === false && (
          <span
            className="rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800"
            title="Neon unreachable — /api/health served the bundled sample instead"
          >
            frozen fallback<span className="hidden sm:inline"> — Neon unreachable</span>
          </span>
        )}
        {unavailable && (
          <span className="rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800">
            run history unavailable
          </span>
        )}
        {live === false && (
          <span className="text-[11px] text-zinc-500">
            Numbers below are from the bundled sample, not a live run.
          </span>
        )}
      </div>

      {/* Fixed shape per cell (label / value / two-line note): a late load cannot reflow.
          Verified by: NOTHING (gap) — no key measures cell height. */}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="eyebrow">{r.label}</dt>
            <dd className="mt-0.5 truncate font-semibold tabular-nums text-zinc-100" title={r.title}>
              {r.value}
            </dd>
            <dd
              className="mt-0.5 line-clamp-2 min-h-[2.1rem] text-xs leading-snug text-zinc-500"
              title={r.note}
            >
              {r.note}
            </dd>
          </div>
        ))}
      </dl>
      {/* Constant text — identical while loading and after; wording disjoint
          from page copy. The second sentence is the one a returning reader
          needs: the daily number moves because the feed moves, and only the
          total is cumulative. Verified by: NOTHING (gap) — no key compares
          copy. */}
      <p className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-snug text-zinc-500">
        Not full coverage: the denominator is {marketSizeLabel} {MARKET_REFERENCE.label}; the ingest
        is capped by design — robots-allowed paths, 5 s pacing, hard stop on any CAPTCHA.
        “Today's scan” moves daily as homes sell or delist; “in total” counts every
        listing ever ingested and only grows.
      </p>
    </section>
  );
}
