# site/app/api/ — the five data endpoints

**What lives here.** One directory per route: `deals/` (the data backbone:
filtered JSON or CSV), `health/` (ingestion health), `meta/` (header
freshness), `zips/` (per-ZIP trends), `listing/[id]/` (one listing's price
history). All read Postgres views through `lib/db/*`.

**The one trap.** **Every** route wraps its query in the same degradation:
DB error → answer from the frozen CSV with `live: false` (invariant I14,
reader `lib/fallback.ts`) — `/api/listing/[id]` is the exception that still
returns `200 unavailable` for history specifically. New routes must copy one of
these two shapes; a route that can 500 breaks the site's core promise. Also:
Next.js restricts what a route module may export — shared constants like
`CRON_SCHEDULE` live in `lib/`, not here.

**Detail.** Each `route.ts` T0 header (they name their SQL constant and the
fallback's honesty notes, e.g. `/api/zips`' fallback trends are demo-only).
