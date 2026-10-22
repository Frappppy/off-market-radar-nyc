// WHAT:   an overflow affordance for tables wider than their column: a hint
//   line plus a right-edge shadow that appear only while content sits
//   off-screen to the right.
// WHY:    S7/S10 — at 390px the /data table is 519px wide in a 356px wrapper,
//   so DOM, drop %, $/sqft and score were off-screen with nothing to say so,
//   and the /trends table overflowed by 20px. The overflow stays INSIDE this
//   wrapper (no page-level horizontal scroll anywhere) but is no longer silent;
//   both affordances disappear at the end of the scroll, and nothing renders
//   when the content fits — wide screens are pixel-identical to before.
// INPUTS: `hint` (the disclosure sentence — it must name the hidden columns),
//   `className` (the scroll box's classes), `children` (the wide table).
// OUTPUTS: the wrapper div + optional hint and edge shadow.
// CALLERS: app/data/deals-table.tsx, app/trends/top-deals.tsx.
// Verified by: NOTHING (gap) — the S7/S10 widths and "no page-level
//   horizontal scroll" rule are measurement claims, unkeyed at runtime.
"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// S7 / S10 — an affordance for tables that are wider than their column.
//
// At 390px the /data table is 519px wide inside a 356px wrapper, so DOM,
// drop %, $/sqft and score were simply off-screen with nothing to say so; the
// /trends table overflowed by 20px. The overflow stays INSIDE this wrapper (no
// page-level horizontal scroll anywhere), but it is no longer silent: while
// there is content to the right we show a hint line and a right-edge shadow,
// and both disappear the moment the reader reaches the end. Nothing renders
// when the content fits, so wide screens are pixel-identical to before.
export default function HScroll({
  className = "",
  hint,
  children,
}: {
  className?: string;
  hint: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth > 1;
    setMore(overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    // Content-driven changes (rows arriving, a filter narrowing the table) do
    // not fire `scroll` or `resize`, so watch the scroll box and its child.
    // Verified by: TS — measure() re-reads the live box; nothing pins the RO.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div>
      {/* Disclosure, not decoration: it names the columns that are off-screen. */}
      {more && (
        <p className="border-b border-white/10 px-2 py-1 text-[11px] text-zinc-400">
          {hint}
        </p>
      )}
      <div className="relative">
        <div ref={ref} className={className}>{children}</div>
        {more && (
          <div
            aria-hidden="true"
            data-testid="hscroll-edge"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#141416] to-transparent"
          />
        )}
      </div>
    </div>
  );
}
