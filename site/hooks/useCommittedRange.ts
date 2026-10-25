"use client";
// WHAT:     `useCommittedRange(value, onCommit)` — a controlled range input
//           whose thumb moves instantly while the commit (the URL write, and
//           therefore the fetch) waits for the end of the interaction.
// WHY:      the DOM slider is the explorer's most-used control and the most
//           expensive one: `onChange` fired on every `input` event, each of
//           which wrote the query string, and every query string is a new
//           /api/deals request (step=5 over 0–180 is up to 36 requests for one
//           drag, each aborted by the next — hooks/useDeals aborts on
//           supersede, so the user pays 36 round trips for one answer). The
//           label must still track the thumb while dragging, so the value is
//           local state and only the commit is deferred.
// INPUTS:   `value` — the committed number (the filter store's `minDom`);
//           `onCommit(next)` — writes it (URL + fetch).
// OUTPUTS:  `value` — the LOCAL thumb position for rendering; `handlers` —
//           spread onto the <input>. Keyboard stays per-step: keyup commits, so
//           an arrow press behaves exactly as it did before.
// CALLERS:  components/filters/Filters.tsx,
//           components/explorer/CompactExplorer.tsx (the two DOM sliders).
// Verified by: shots/phase3-runtime-gate.json → data_keyboard.rangeOperable
//   (rangeFrom 60 → rangeTo 65) — keyboard stepping still commits; the
//   "one fetch per drag instead of ~36" half is NOTHING (gap) — no key counts
//   /api/deals requests during a pointer drag.

import { useCallback, useEffect, useRef, useState } from "react";

export function useCommittedRange(value: number, onCommit: (next: number) => void) {
  const [local, setLocal] = useState(value);
  // Refs, because the commit happens in an event handler that must see the
  // latest thumb position and the latest committed value without re-binding.
  const localRef = useRef(local);
  const committedRef = useRef(value);
  const commitRef = useRef(onCommit);
  const interacting = useRef(false);

  useEffect(() => {
    commitRef.current = onCommit;
  });

  // Follow an external write (Reset, a back/forward navigation, another
  // control) — but never fight a drag in progress.
  useEffect(() => {
    committedRef.current = value;
    if (!interacting.current) {
      localRef.current = value;
      setLocal(value);
    }
  }, [value]);

  const flush = useCallback(() => {
    if (!interacting.current) return;
    interacting.current = false;
    if (localRef.current !== committedRef.current) commitRef.current(localRef.current);
  }, []);

  const start = useCallback(() => {
    interacting.current = true;
  }, []);

  return {
    value: local,
    handlers: {
      value: local,
      onChange: (e: { target: { value: string } }) => {
        const next = Number(e.target.value);
        localRef.current = next;
        setLocal(next);
      },
      onPointerDown: start,
      onKeyDown: start,
      onPointerUp: flush,
      onPointerCancel: flush,
      onKeyUp: flush,
      // The safety net: releasing the pointer outside the input (dragged off
      // the edge of the map column and dropped) still commits on blur.
      onBlur: flush,
    },
  };
}
