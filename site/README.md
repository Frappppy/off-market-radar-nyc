# site/ — Next.js 15 + React 19 + Tailwind v4 presentation layer (Vercel)

**What lives here.** The deployed site (<https://off-market-radar-nyc.vercel.app>).
`app/` routes (5 pages + 5 JSON/CSV APIs + SEO endpoints), `components/`
(client components in five themed subdirectories), `lib/` (SQL, types, pure
helpers, URL-state), `hooks/` (the three fetch hooks), `public/data/` (the
frozen fallback CSV), `shots/` (screenshot + runtime-gate evidence from the
phase-3 Playwright gate). Vercel's Root Directory points **here**.

**Architecture.** Pages are thin *server* components that render *client*
components; all data arrives client-side from `/api/*` after hydration. Every
API degrades to the frozen 82-row CSV with `live:false` when Neon is
unreachable — never an error page (invariant I14).

**The one trap.** Two known gaps, do not be surprised: `npm run lint` has no
eslint dependency behind it (use `npm run typecheck` as the gate), and
`site/` has **zero automated tests** — runtime evidence lives in `shots/` and
`jobs/tier1-*/evidence/` (ARCHITECTURE.md §6 I14).

**Detail.** [ARCHITECTURE.md](../../ARCHITECTURE.md) §1/§2 → subdirectory
READMEs → each file's T0 header. The route matrix is in the root
[README.md](../../README.md) § "Site routes".
