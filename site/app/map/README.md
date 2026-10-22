# site/app/map/ — `/map`

**What lives here.** The full explorer route: `layout.tsx` (metadata shim) +
`page.tsx` (renders `<Explorer variant="full" />`). Everything else for this
route lives in `components/explorer/` (map + filters + SideCard are composed
there, not here).

**The one trap.** Same as the other client routes: the layout exists **only**
to export `metadata`; the page must stay inside its Suspense boundary or
`useSearchParams` bails out to client-side rendering (the old site-wide CLS
defect, roadmap § "Post-deploy hardening round").

**Detail.** `Explorer` T0 headers; a11y evidence (keyboard-operable pins,
heading order fix): `jobs/tier1-gate-fixes/evidence/gate-fixes.md`.
