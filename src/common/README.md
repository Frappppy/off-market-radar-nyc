# src/common/ — shared primitives for the three stages

**What lives here** (phase-1 dedupe of what used to be 3 copies each):

| File | Owns |
|---|---|
| `runid.py` | `RUN_ID_RE`, `utc_stamp()`, `resolve_run_id()`, `run_id_from_dir()` |
| `timeutil.py` | `utc_now_iso()` — the single `Z`-suffixed formatter (stages 1–2) |
| `evidence.py` | `write_manifest()` / `append_log()` (+ `utc_now`/`iso`, absorbed from the deleted `store/reporting.py`) |
| `coerce.py` | `text_to_bool()` with per-stage token sets (strict vs permissive) |

`__init__.py` deliberately imports **none** of the submodules, so a stage pulls
in exactly what it names.

**The one trap.** `resolve_run_id` is *one function with three fallback
policies*, chosen by keyword argument — scrape falls back to a UTC stamp, clean
to `"unknown"`, store to the parent dir name. Do not "simplify" them into one
default; that asymmetry is deliberate (REFACTOR_PLAN phase 1, verified
byte-identical).

**Detail.** Each file's T0 header. Tests: `tests/test_common.py`.
