# src/ — the Python pipeline (three stages + shared primitives)

**What lives here.** Stage 1 `scrape/` (Zillow → `jobs/<run_id>/raw`), stage 2
`clean/` (JSONL → scored Parquet/CSV), stage 3 `store/` (→ Postgres/Neon), and
`common/` (run-id, timestamps, evidence writers, coercion — the phase-1 dedupe
target shared by all three). This is a **namespace package**: there is no
`src/__init__.py` on purpose.

**How to run.** From the repo root with the stage's `-m` entry point —
`python -m src.scrape|clean|store` — or let `scripts/run_daily.py` drive all
three as subprocesses. Interpreter: the conda env path in the root `README.md`
Quickstart (system Python here has no `ensurepip`).

**The one trap.** Never run a stage from inside `src/` (`python cli.py` fails on
relative imports); the `__main__.py` files are the only intended entry.

**Detail.** [ARCHITECTURE.md](../ARCHITECTURE.md) §2 (stage contracts) → each
subdirectory's `README.md` → each file's T0 header (`WHAT/WHY/INPUTS/OUTPUTS/
CALLERS`). The field-level contract these stages exchange is
[docs/data_contract.md](../docs/data_contract.md); why each rule exists is
[docs/decisions.md](../docs/decisions.md).
