# site/components/ui/ — shared primitives

**What lives here.** `HScroll.tsx` — the scroll-hint wrapper for wide tables
(edge gradients + keyboard-scrollable region), used by `/data` and `/trends`.

**The one trap.** This directory is the *destination* for primitives: when two
components grow identical markup (a pill, a wrapper, a control), extract it
**here** with a T0 header rather than copying it a third time — the repo's
whole phase-1 story is what happens when that doesn't happen (`SCORES`,
money formatting and score pills each existed 3–11 times).

**Detail.** `HScroll.tsx` T0 header.
