"use client";
// WHAT:     the browser-local shortlist — toggle/read one listing's saved flag
//           in localStorage (V1: browser only, websiteplan §2).
// WHY:      the two helpers lived inside components/listings/SideCard.tsx
//           (REPO_MAP §8.2: over-exported from a component) and the
//           /listing/[id] page offers the same saved toggle, so the storage
//           key and the toggle semantics live here once.
// INPUTS:   a Deal row, keyed by (source, listing_id) via lib/dates.listingKey.
// OUTPUTS:  useShortlist(deal) → { saved, toggle } — the SSR-safe wiring
//           (localStorage is unavailable during SSR, so the flag is read in an
//           effect, never during render). The two helpers it wires
//           (toggleShortlist → flips and returns the saved flag;
//           isShortlisted → reads it) are module-local: REPO_MAP §8.2 names
//           SideCard.toggleShortlist as over-exported, and nothing outside
//           this file called it after the move.
// CALLERS:  components/listings/SideCard, app/listing/[id]/page.
// Verified by: shots/phase3-runtime-gate.json → listing.shortlistToggled,
//   listing.shortlistRestored — the toggle/read semantics are asserted end to
//   end; the SSR-safety wiring itself is NOTHING (gap).

import { useEffect, useState } from "react";
import type { Deal } from "./api-types";
import { listingKey } from "./dates";

function toggleShortlist(d: Deal): boolean {
  // V1: browser localStorage only (websiteplan §2). Returns true if now saved.
  const raw = localStorage.getItem("shortlist");
  const list: string[] = raw ? JSON.parse(raw) : [];
  const k = listingKey(d);
  const next = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
  localStorage.setItem("shortlist", JSON.stringify(next));
  return next.includes(k);
}

// localStorage is unavailable during SSR, so the saved flag is read in an
// effect, never during render. Same key as toggleShortlist above.
function isShortlisted(d: Deal): boolean {
  try {
    const raw = localStorage.getItem("shortlist");
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) && list.includes(listingKey(d));
  } catch {
    return false;
  }
}

/** The SideCard/listing-page wiring of the two helpers above, in one hook. */
export function useShortlist(deal: Deal | null): { saved: boolean; toggle: () => void } {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setSaved(deal ? isShortlisted(deal) : false);
  }, [deal]);
  return {
    saved,
    toggle: () => {
      if (deal) setSaved(toggleShortlist(deal));
    },
  };
}
