"use client";
import { useEffect, useState } from "react";
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
  return (
    <span className="whitespace-nowrap text-xs text-zinc-400" title={meta.run_id ?? ""}>
      Data as of {date}
      {/* detail only where there is room; the hero repeats these numbers */}
      <span className="hidden sm:inline">
        {" · "}{meta.total_tracked ?? "—"} tracked · {meta.high_count ?? "—"} High · source {meta.source}
      </span>
      {!meta.live && (
        <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">
          demo sample<span className="hidden sm:inline"> — live waking</span>
        </span>
      )}
    </span>
  );
}
