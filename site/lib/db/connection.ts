// WHAT:     the server-only Neon connection factory — `getSql()`.
// WHY:      split from lib/db.ts (REFACTOR_PLAN §5 Phase 3) so the SQL text
//           (db/queries.ts) can be read and reasoned about without the driver
//           import. Neon's HTTP driver is required on Vercel serverless
//           (@neondatabase/serverless); classic pg pools die on serverless.
// INPUTS:   DATABASE_URL from the environment, validated through @neon/env
//           against neon.ts (Postgres only — DATABASE_URL is the pooled URL,
//           correct for serverless app traffic).
// OUTPUTS:  a neon query function, one per API route call.
// CALLERS:  app/api/{deals,health,meta,zips,listing}.
//
// Called per request, never at module scope: a missing/invalid var throws
// inside the route's try/catch and degrades to the frozen sample rather than
// failing the module import. DATABASE_URL should be a read-only role; it
// lives in Vercel env / local .env.local, never in code.
// Verified by: /api/deals fallback path — a throw here degrades to the frozen
//   sample per route; env presence itself is NOTHING (gap).

import { parseEnv } from "@neon/env";
import { neon } from "@neondatabase/serverless";
import neonConfig from "@/neon";

export function getSql() {
  const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
  return neon(postgres.databaseUrl);
}
