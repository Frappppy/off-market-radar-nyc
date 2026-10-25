# tests/ — the pytest suite (run from the repo root)

**What lives here.** 17 test modules + `fixtures/`; run with
`python -m pytest -q` (config in `pyproject.toml`: `pythonpath = ["."]`,
`testpaths = ["tests"]`). Baseline 2026-10-25: **220 passed** here — the two
DataImpulse-credential tests (`test_scrape.py`) skip on a machine without
`config/dataimpulse.local.env`, which is every CI run, so Actions sees
218 passed + 2 skipped.

| File | Pins |
|---|---|
| `test_clean.py` + `test_clean_{score,derive,frame}.py` | CLI end-to-end; scoring rule + boundaries; derived columns + dtypes; frame edge cases (the 4 modules are the topic split of the old monolith) |
| `test_scrape.py` | parsers/record shapes, robots gate (14 cases), CAPTCHA detection, CLI defaults |
| `test_contract_parity.py` | contract ↔ schema ↔ code column parity (I2/I12/I13) + negative drift tests |
| `test_store_{cli,db,flow,loader,mapping,stale}.py` | stage-3 exit codes, DSN redaction, full flow on FakeConn, loader prefs, row→tuple, stale rule |
| `test_schema_sqlglot.py` | schema/migration/views parse; `is_active` guard; upsert SQL |
| `test_common.py` | `src/common` primitives |
| `test_run_daily.py` | volume policy (30/120/5.0), stage commands, env loading, the `--record-failure` path that makes a skipped stage 3 observable |
| `test_harvest.py` | ZIP shard plan, resumable ledger, crash-safe JSONL, payload-based block detection, detail merge |
| `test_workflow_yaml.py` | cron, exactly six secrets, no leaked values, the checks.yml gates (headers, ruff, mypy, pytest, contract) and the credential-free run |

**The one trap.** The **2 skips are by design**: `test_proxy_url_*` /
`test_scrub_secrets_*` call `pytest.skip` when `proxy.load_dataimpulse_credentials()`
finds nothing — so they run on a machine holding `config/dataimpulse.local.env`
and skip in CI, which by policy has no credentials at all
(`test_checks_workflow_references_no_secrets` keeps it that way). Also: `checks.yml`
runs this suite on every push/PR; `daily_pipeline.yml` runs the pipeline itself.

**Detail.** Each module's own docstring. Unpinned invariants ("gaps"):
ARCHITECTURE.md §6.
