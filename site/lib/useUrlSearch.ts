// WHAT:   the URL-query external store — useUrlSearch() (read-only
//   useSearchParams equivalent), useUrlSearchReady() (the `ready` gate) and
//   setUrlSearch() (write-back after router.replace).
// WHY:    see the F1 block below for the full mechanism and the two measured
//   incidents (the BAILOUT_TO_CLIENT_SIDE_RENDERING shell / 0.55808 CLS, and
//   the deep-link race that overwrote a filtered cohort).
// INPUTS: window.location.search (folded in on subscribe and on popstate);
//   caller-written query strings via setUrlSearch.
// OUTPUTS: a URLSearchParams view of the current search, the boolean `ready`,
//   and the store write. Server snapshot is the constant { "", false } so SSR
//   and hydration always agree.
// CALLERS: lib/useFilters.ts, hooks/*, app/data/page.tsx,
//   components/{filters/FilterNav,filters/FilterNotices,explorer/*}.
"use client";
import { useMemo, useSyncExternalStore } from "react";

// ---- URL-query external store (useSearchParams bailout replacement) ----
// F1 — why this exists instead of `useSearchParams()`.
//
// `useSearchParams()` from next/navigation tells Next.js the page cannot be
// statically prerendered: the nearest Suspense boundary is emitted as
// `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">`. Every explorer
// route wrapped its body in <Suspense>, so all four routes shipped that marker
// and the served `<main>` was a ~150-character "Loading …" placeholder on
// /map, /data and /trends. `main` is `flex-1`, so in that shell the 465px
// footer sat inside the first 390px screen and then left it when hydration
// inserted the real page — a 0.55808 layout shift on three routes, byte for
// byte (jobs/tier1-cls-diagnosis/evidence/cls-diagnosis.md §3.1).
// Verified by: NOTHING (gap) — the CLS numbers live in the evidence file; no
// runtime key re-measures the CSR bailout shell.
//
// This module keeps the same read/write ergonomics without the opt-out: a
// tiny external store seeded from `window.location.search`. The server render
// AND the first hydration render both see "" (the store's server snapshot), so
// they agree with each other and with the pages' defaults; the live query
// string is folded in as soon as anything subscribes. Writes go through the
// callers that already call `router.replace`, via `setUrlSearch`.
//
// Gate fix (see jobs/tier1-gate-fixes/evidence/gate-fixes.md §1) — that
// one-commit gap was also a correctness bug on a FILTER deep link. `getSnapshot`
// returns `""` for the whole first render, so every filter-aware `useEffect`
// fired once against the server-snapshot default (`score=High,Medium&min_dom=60`)
// and then again against the reader's real query. The two requests raced, and on
// /trends the default one — which has no staleness guard — resolved last and
// overwrote the deep-linked cohort (133 rows instead of 43, in most runs).
//
// `ready` is the missing piece: it is `false` until this store has actually
// observed `window.location`, i.e. until `search` is the reader's query and not
// the SSR placeholder. Pages gate their first fetch on it, which removes the
// spurious request AND the race window in one move. The store's state is a
// single cached object so `getSnapshot` stays referentially stable (a fresh
// object every call would loop React).
// Verified by: NOTHING (gap) — nothing renders a deep-linked /trends filter
//   twice to prove the 133-vs-43 race stays gone.
type UrlSearchState = { search: string; ready: boolean };

let state: UrlSearchState = { search: "", ready: false };

const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const readLocation = () => (typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, ""));

function setState(next: UrlSearchState) {
  if (next.search !== state.search || next.ready !== state.ready) {
    state = next;
    emit();
  }
}

function syncFromLocation() {
  // First call flips `ready`; later calls only move `search`. Either way the
  // change is emitted, so a subscriber that is waiting on `ready` wakes up even
  // when the URL happens to carry no query string.
  setState({ search: readLocation(), ready: true });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Fold the live URL in on (re)subscribe: the first subscriber after a soft
  // navigation is what corrects a store left over from the previous route.
  syncFromLocation();
  window.addEventListener("popstate", syncFromLocation);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", syncFromLocation);
  };
}

const getSnapshot = () => state;
// Used by the server render and by the hydration render, which must match it.
// `ready: false` is deliberate: the first client render must equal the server
// render, and `ready` is what tells the pages that it did not.
// Verified by: TS — useSyncExternalStore contract; SERVER_STATE is constant.
const SERVER_STATE: UrlSearchState = { search: "", ready: false };
const getServerSnapshot = () => SERVER_STATE;

/**
 * Record a query string a caller has just written with `router.replace`
 * (`pushState` does not fire `popstate`, so the store cannot observe it).
 * Pass the string without a leading `?`.
 */
export function setUrlSearch(search: string) {
  setState({ search: search.replace(/^\?/, ""), ready: true });
}

/** The whole store state: the query string plus whether it is the live one.
 *  Module-local (REPO_MAP §8.2 over-exports): only the two hooks below read it. */
function useUrlSearchState(): UrlSearchState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Read-only equivalent of `useSearchParams()`, without the CSR bailout. */
export function useUrlSearch(): URLSearchParams {
  const { search } = useUrlSearchState();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/**
 * `false` during SSR and the first hydration render, `true` from the first
 * commit after the live query string has been folded in. A filter-aware fetch
 * effect must not run while this is `false`, or it fetches the SSR default
 * before the reader's own query arrives.
 */
export function useUrlSearchReady(): boolean {
  return useUrlSearchState().ready;
}
