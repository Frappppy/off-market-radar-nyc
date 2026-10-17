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
