"use client";

// A 48px sparkline in inline SVG, not Recharts (roadmap 1.2).
// Justification for deviating from the chart library already in package.json:
// Recharts needs ResponsiveContainer, which measures its parent on mount — a
// real failure mode inside the absolutely-positioned card that floats over the
// map (zero-height first paint) — and it would add an SVG layer plus sizing
// observers to a surface that is read once and never interacted with. This
// component is a pure function of its props: one polyline, no hooks, no
// dependency, deterministic output. Recharts still owns the /trends charts.
//
// Decorative by design: the same numbers are printed as text by SideCard
// (snapshot count, series range, every reduction), so the SVG is aria-hidden
// and never the only place a value lives.
export default function PriceSparkline({
  points,
  width = 260,
  height = 48,
}: {
  points: Array<{ snapshot_date: string; price: number | null }>;
  width?: number;
  height?: number;
}) {
  const pad = 4;

  // Null / non-finite prices are dropped, never coerced to 0: a missing day is
  // missing, and drawing it at $0 would invent a cliff that never happened.
  const usable = points.filter(
    (p): p is { snapshot_date: string; price: number } =>
      typeof p.price === "number" && Number.isFinite(p.price)
  );

  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);

  // 0 usable points → a flat placeholder line, so the card keeps its shape and
  // the caller can print the honest reason underneath.
  if (usable.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full text-zinc-700"
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const prices = usable.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;

  // Uniform scaling: x spreads across the box, y is centred when every day has
  // the same price (span === 0 would otherwise divide by zero).
  const x = (i: number) => (usable.length === 1 ? width / 2 : pad + (i / (usable.length - 1)) * innerW);
  const y = (v: number) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * innerH);

  // One point is a dot, not a zero-length line: a line between a point and
  // itself renders as nothing at all.
  if (usable.length === 1) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full text-zinc-300"
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="1"
        />
        <circle cx={x(0)} cy={y(usable[0].price)} r="2.5" fill="currentColor" />
      </svg>
    );
  }

  const coords = usable.map((p, i) => `${x(i).toFixed(2)},${y(p.price).toFixed(2)}`);
  const line = coords.join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  const last = usable[usable.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full text-zinc-300"
      aria-hidden="true"
      focusable="false"
    >
      {span > 0 && <polygon points={area} fill="currentColor" fillOpacity="0.1" />}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(usable.length - 1)} cy={y(last.price)} r="2.5" fill="currentColor" />
    </svg>
  );
}
