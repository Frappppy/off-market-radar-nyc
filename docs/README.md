# docs/ — the written record

**What lives here.**

| File | Role | Status |
|---|---|---|
| `data_contract.md` | ⭐ **source of truth**: field tables, CLI signatures, Stage-3 DDL, scoring, pacing | current; its DDL block is hand-mirrored from `sql/schema.sql`, now pinned by `tests/test_contract_parity.py` |
| `decisions.md` | ADR-lite: why each irreversible choice is what it is (thresholds, dual robots gates, recency guard, fallback CSV, Windows CI, conda env, ≤200-line rule) | current |
| `incidents/` | dated incident narratives referenced by one-line pointers in code | fixed history |
| `roadmap.md` | tiered plan + Tier-1 build log | current; half of it is changelog |
| `websiteplan.md` | the original Vercel build plan, kept as a status doc | mostly historical |
| `apply_tier1_migration.md` | completed migration runbook + hazards H1–H3 | still the re-apply procedure |
| `deploy_github.md` | CI + Neon secret wiring | current |
| `robots_precheck.md` | dated compliance pre-flight + operating limits | evidence record |

**The one trap.** `data_contract.md` is the contract every stage is written
against — change it in the **same commit** as the code/schema it describes (or
`test_contract_parity.py` fails). Never edit `incidents/` narratives or
`robots_precheck.md` to "freshen" them: they are dated evidence.

**Detail.** The big picture is [ARCHITECTURE.md](../ARCHITECTURE.md); the
pre-reorg baseline is [REPO_MAP.md](../REPO_MAP.md) (historical).
