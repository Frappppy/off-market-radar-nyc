"use client";
import { useEffect, useState } from "react";
import { CRON_SCHEDULE } from "@/lib/cron";
import { fmtCount, marketSizeLabel, MARKET_REFERENCE } from "@/lib/market";
import type { Health } from "@/lib/types";

// Ingestion health card (roadmap 1.4). The daily job is otherwise invisible, so
// a gap in the trend line looks like the site is broken. This card answers
// "why is there a hole in the chart?" before the client asks: last successful
// run, next scheduled run, coverage, 30-day run tallies and how much history
// has accumulated. Scope rules hold here like everywhere else — coverage is a
// SAMPLE against a disclosure denominator, never a claim of full coverage.
//
// Fixed locale and an explicit UTC zone: the cron is 10:00 UTC, so a local-time
// rendering sitting next to "0 10 * * * UTC" would invite a misreading. The year
// is deliberately omitted from the visible string (it does not fit a phone-width
// cell) and the raw ISO value is always available in the element's `title`.
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

export default function IngestionHealth({ className = "" }: { className?: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
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
      label: "Coverage (sample)",
      // Denominator comes from lib/market.ts, never hardcoded, so this card and
      // the hero state the same slice of the same market.
      value: loading ? "…" : tracked != null ? `${fmtCount(tracked)} of ${marketSizeLabel}` : "—",
      note: loading
        ? "counting the newest snapshot…"
        : pct != null
          ? `${pct.toFixed(1)}% of ${MARKET_REFERENCE.label} — a sample`
          : "sample size unknown",
      title: `Disclosure denominator: ${fmtCount(MARKET_REFERENCE.listings)} ${MARKET_REFERENCE.label} as of ${MARKET_REFERENCE.as_of} — our ingestion is capped on purpose, so this is a slice of the market`,
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
      className={`panel p-3 ${className}`}
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

      {/* Fixed shape (one line label / value / two-line note per cell) so the
          card does not reflow the page when it loads late. Two columns even on
          a phone, matching the KPI strips. */}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="eyebrow">{r.label}</dt>
            <dd className="mt-0.5 truncate font-semibold tabular-nums text-zinc-100" title={r.title}>
              {r.value}
            </dd>
            {/* Two reserved lines: long enough for the scope wording, and a fixed
                height so the card cannot reflow the page when it lands. */}
            <dd
              className="mt-0.5 line-clamp-2 min-h-[2.1rem] text-xs leading-snug text-zinc-500"
              title={r.note}
            >
              {r.note}
            </dd>
          </div>
        ))}
      </dl>

      {/* Constant text — identical while loading and after — so the honest scope
          statement is never the thing that gets clipped, and never shifts the
          card. The numbers above are a SAMPLE, not full coverage. Wording stays
          disjoint from the page copy so no sentence appears twice on a view. */}
      <p className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-snug text-zinc-500">
        Not full coverage: the denominator is {marketSizeLabel} {MARKET_REFERENCE.label}; the ingest
        is capped by design — robots-allowed paths, 5 s pacing, hard stop on any CAPTCHA.
      </p>
    </section>
  );
}
