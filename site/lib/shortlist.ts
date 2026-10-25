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
//           effect, never during render). The three helpers it wires
//           (readShortlist → the one safe read; toggleShortlist → flips and
//           returns the saved flag; isShortlisted → tests one key) are
//           module-local: REPO_MAP §8.2 names SideCard.toggleShortlist as
//           over-exported, and nothing outside this file called it after the
//           move.
// CALLERS:  components/listings/SideCard, app/listing/[id]/page.
// Verified by: shots/phase3-runtime-gate.json → listing.shortlistToggled,
//   listing.shortlistRestored — the toggle/read semantics are asserted end to
//   end; the SSR-safety wiring itself is NOTHING (gap).

import { useEffect, useState } from "react";
import type { Deal } from "./api-types";
import { listingKey } from "./dates";

/** The saved keys, or [] for anything that is not a JSON string array.
 *  `isShortlisted` already read through a try/catch; `toggleShortlist` did not,
 *  so one corrupted/quota-rejected localStorage value ("null", "[]…", a plain
 *  string, or an array of numbers) made the Save button throw on click instead
 *  of starting the list over. Same rule now, in one place.
 *  Verified by: NOTHING (gap) — the shots gate covers the happy path only. */
function readShortlist(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem("shortlist") ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toggleShortlist(d: Deal): boolean {
  // V1: browser localStorage only (websiteplan §2). Returns true if now saved.
  const k = listingKey(d);
  const list = readShortlist();
  const next = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
  try {
    localStorage.setItem("shortlist", JSON.stringify(next));
  } catch {
    // Storage can refuse (private mode, quota) — the in-memory toggle still
    // answers this click, and the next read restores whatever is really saved.
  }
  return next.includes(k);
}

// localStorage is unavailable during SSR, so the saved flag is read in an
// effect, never during render. Same key as toggleShortlist above.
function isShortlisted(d: Deal): boolean {
  return readShortlist().includes(listingKey(d));
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
