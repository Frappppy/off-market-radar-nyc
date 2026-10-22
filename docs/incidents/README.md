# docs/incidents/ — dated incident narratives

**What lives here.** The "why" behind three 2026-10-15 stage-1 incidents,
moved out of code comments during the reorg (each code site keeps only a
one-line pointer here):

- `2026-10-15-proxy-sticky-403.md` — the sticky `project1` exit answered the
  first Zillow request with a PerimeterX 403; the run switched to rotating.
- `2026-10-15-credentials-env-precedence.md` — env vars vs `*.local.env`
  precedence while chasing the above.
- `2026-10-15-px-cookie-chain.md` — what the PerimeterX challenge chain looked
  like on the wire.

**The one trap.** These are **immutable records** — they describe what happened
on a dated run, including facts later superseded (e.g. the sticky-403 narrative
cites a probe capture under the gitignored `jobs/probe/`, which was never
tracked and does not exist in the repo). Corrections go in a *new* dated file,
never by editing an old one.
