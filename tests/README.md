# tests/ — the pytest suite (run from the repo root)

**What lives here.** 16 test modules + `fixtures/`; run with
`python -m pytest -q` (config in `pyproject.toml`: `pythonpath = ["."]`,
`testpaths = ["tests"]`). Baseline 2026-10-22: **164 passed, 2 skipped**.

| File | Pins |
|---|---|
| `test_clean.py` + `test_clean_{score,derive,frame}.py` | CLI end-to-end; scoring rule + boundaries; derived columns + dtypes; frame edge cases (the 4 modules are the topic split of the old monolith) |
| `test_scrape.py` | parsers/record shapes, robots gate (14 cases), CAPTCHA detection, CLI defaults |
| `test_contract_parity.py` | contract ↔ schema ↔ code column parity (I2/I12/I13) + negative drift tests |
| `test_store_{cli,db,flow,loader,mapping,stale}.py` | stage-3 exit codes, DSN redaction, full flow on FakeConn, loader prefs, row→tuple, stale rule |
| `test_schema_sqlglot.py` | schema/migration/views parse; `is_active` guard; upsert SQL |
| `test_common.py` | `src/common` primitives |
| `test_run_daily.py` | volume policy (30/120/5.0), stage commands, env loading |
| `test_workflow_yaml.py` | cron, exactly six secrets, no leaked values |

**The one trap.** The **2 skips are by design**: `test_proxy_url_*` /
`test_scrub_secrets_*` call `pytest.skip` without `DATAIMPULSE_*` credentials —
expected on any machine without proxy creds; they run in CI. Also: CI runs the
pipeline, **not** pytest (no test step in the workflow yet).

**Detail.** Each module's own docstring. Unpinned invariants ("gaps"):
ARCHITECTURE.md §6.
