"""WHAT:      scripts/run_daily.py guards — UTC run_id format, the daily volume
           policy (30 pages / 120 details / 5s), stage command construction,
           --skip-scrape reuse rules, latest_raw_dir, run_log.md evidence for
           success/failure/skip flows, the ingestion-failure recording hook,
           and config/*.local.env precedence.
WHY:       The orchestrator is what CI actually executes; its defaults ARE the
           compliance/volume policy and its failure semantics decide whether a
           bad run exits non-zero. Stages are tiny scripted subprocesses.
INPUTS:    the run_daily module (imported by file path), src.common.ingestion
           and tmp_path.
OUTPUTS:   pytest verdicts only; run_log.md files inside tmp_path.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
"""

import importlib.util
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location("run_daily", ROOT / "scripts" / "run_daily.py")
run_daily = importlib.util.module_from_spec(_SPEC)
sys.modules["run_daily"] = run_daily  # dataclasses need the module registered
_SPEC.loader.exec_module(run_daily)

from src.common import ingestion  # noqa: E402  (run_daily put ROOT on sys.path)


def test_utc_run_id_format():
    run_id = run_daily.utc_run_id()
    assert re.fullmatch(r"\d{8}-\d{6}", run_id), run_id


def test_daily_volume_policy_is_what_the_docs_claim():
    """The daily job's defaults ARE the compliance/volume policy — pin them."""
    args = run_daily.parse_args([])
    assert (args.pages, args.max_details, args.delay) == (30, 120, 5.0)


def test_build_stages_matches_contract():
    stages = run_daily.build_stages("20261014-143000", pages=5, max_details=150, delay=5.0)
    assert [s.name for s in stages] == ["scrape", "clean", "store"]
    scrape, clean, store = (s.cmd for s in stages)
    assert scrape == [
        sys.executable, "-m", "src.scrape",
        "--pages", "5", "--max-details", "150", "--delay", "5.0",
        "--out", "jobs/20261014-143000/raw",
    ]
    assert clean == [
        sys.executable, "-m", "src.clean",
        "--in", "jobs/20261014-143000/raw", "--out", "jobs/20261014-143000/cleaned",
        "--sanitize",  # daily output drops unpriced / out-of-market rows
    ]
    assert store == [sys.executable, "-m", "src.store", "--in", "jobs/20261014-143000/cleaned"]
    for stage in stages:
        assert stage.cmd[0] == sys.executable  # SAME interpreter everywhere


def test_build_stages_skip_scrape(tmp_path):
    raw = tmp_path / "jobs" / "20261013-090000" / "raw"
    raw.mkdir(parents=True)
    (raw / "listings.jsonl").write_text("{}\n", encoding="utf-8")
    stages = run_daily.build_stages("20261014-143000", skip_scrape=True, raw_dir=raw, root=tmp_path)
    assert stages[0].skip_reason is not None
    assert stages[0].cmd == []
    assert "--in jobs/20261013-090000/raw" in " ".join(stages[1].cmd)
    assert stages[2].cmd[-1] == "jobs/20261014-143000/cleaned"


def test_build_stages_skip_scrape_without_raw_raises():
    with pytest.raises(SystemExit):
        run_daily.build_stages("20261014-143000", skip_scrape=True, raw_dir=None)


def test_latest_raw_dir(tmp_path):
    (tmp_path / "jobs").mkdir()
    assert run_daily.latest_raw_dir(tmp_path) is None
    raw = tmp_path / "jobs" / "20261013-090000" / "raw"
    raw.mkdir(parents=True)
    assert run_daily.latest_raw_dir(tmp_path) is None  # no listings.jsonl yet
    (raw / "listings.jsonl").write_text("{}\n", encoding="utf-8")
    assert run_daily.latest_raw_dir(tmp_path) == raw
    newer = tmp_path / "jobs" / "20261014-100000" / "raw"
    newer.mkdir(parents=True)
    (newer / "listings.jsonl").write_text("{}\n", encoding="utf-8")
    assert run_daily.latest_raw_dir(tmp_path) == newer  # run_id order = time order


def test_run_pipeline_success(tmp_path):
    stages = [
        run_daily.Stage("alpha", [sys.executable, "-c", "print('alpha-ok')"]),
        run_daily.Stage("beta", [sys.executable, "-c", "print('beta-ok')"]),
    ]
    rc = run_daily.run_pipeline(stages, "20990101-000000", root=tmp_path)
    log = (tmp_path / "jobs" / "20990101-000000" / "run_log.md").read_text(encoding="utf-8")
    assert rc == 0
    assert "alpha-ok" in log and "beta-ok" in log
    assert "| alpha | success |" in log
    assert "overall: success" in log


def test_run_pipeline_failure_skips_later_stages(tmp_path):
    stages = [
        run_daily.Stage("alpha", [sys.executable, "-c", "print('alpha-ok')"]),
        run_daily.Stage("beta", [sys.executable, "-c", "import sys; print('beta-boom'); sys.exit(3)"]),
        run_daily.Stage("gamma", [sys.executable, "-c", "print('gamma-should-not-run')"]),
    ]
    rc = run_daily.run_pipeline(stages, "20990101-000001", root=tmp_path)
    log = (tmp_path / "jobs" / "20990101-000001" / "run_log.md").read_text(encoding="utf-8")
    assert rc == 1
    assert "beta-boom" in log
    assert "exit code: 3" in log
    assert "SKIPPED: earlier stage `beta` failed" in log
    assert "gamma-should-not-run" not in log  # never executed
    assert "| beta | failed (exit 3) |" in log
    assert "| gamma | skipped (earlier stage `beta` failed) |" in log
    assert "overall: failed (`beta`)" in log


def test_run_pipeline_intentional_skip_is_not_failure(tmp_path):
    stages = [
        run_daily.Stage("scrape", [], skip_reason="--skip-scrape (reusing jobs/x/raw)"),
        run_daily.Stage("clean", [sys.executable, "-c", "print('clean-ok')"]),
    ]
    rc = run_daily.run_pipeline(stages, "20990101-000002", root=tmp_path)
    log = (tmp_path / "jobs" / "20990101-000002" / "run_log.md").read_text(encoding="utf-8")
    assert rc == 0
    assert "SKIPPED: --skip-scrape" in log
    assert "overall: success" in log


# --- ingestion-failure recording (the pipeline_runs visibility hook) ---------
# The policy lives in src/common/ingestion.py (run_daily's line budget); the
# orchestrator owns only the decision to call it.


def test_failure_note_names_the_stage_exit_and_last_line():
    f = ingestion.RunFailure("20261020-101500", "scrape", 1, "scrape failed: blocked ")
    assert f.note == "stage `scrape` failed (exit 1): scrape failed: blocked"
    # multi-line / padded detail is collapsed to one safe line, then capped
    noisy = ingestion.RunFailure("r", "clean", 2, "boom\n  Traceback...\n" + "y" * 900)
    assert len(noisy.note) == ingestion.NOTE_LIMIT
    assert "\n" not in noisy.note
    # no output at all (killed process) still names the stage and exit code
    assert ingestion.RunFailure("r", "store", 3, None).note == "stage `store` failed (exit 3)"


def test_record_failure_command_shape():
    f = ingestion.RunFailure("20261020-101500", "scrape", 1, "scrape failed: blocked")
    assert ingestion.record_failure_command(f, interpreter="PY") == [
        "PY", "-m", "src.store", "--record-failure",
        "--run-id", "20261020-101500",
        "--note", "stage `scrape` failed (exit 1): scrape failed: blocked",
    ]


def test_record_ingestion_failure_is_best_effort(monkeypatch):
    """A recorder that cannot run must only produce a log line — no raise, so a
    dead database never turns one failed run into a crashed orchestrator."""

    class _Proc:
        returncode = 2
        stdout = ""
        stderr = "src.store: ERROR: postgresql://u:***@host/db refused"

    monkeypatch.setattr(ingestion.subprocess, "run", lambda *a, **k: _Proc())
    line = ingestion.record_ingestion_failure(
        ingestion.RunFailure("r", "scrape", 1, "blocked")
    )
    assert line.startswith("- pipeline_runs: failure NOT recorded (exit 2)")

    def explode(*a, **k):
        raise OSError("no python here")

    monkeypatch.setattr(ingestion.subprocess, "run", explode)
    assert "NOT recorded" in ingestion.record_ingestion_failure(
        ingestion.RunFailure("r", "scrape", 1, None)
    )

    _Proc.returncode = 0
    monkeypatch.setattr(ingestion.subprocess, "run", lambda *a, **k: _Proc())
    line = ingestion.record_ingestion_failure(
        ingestion.RunFailure("r", "scrape", 1, None)
    )
    assert "status `failed` recorded (stage `scrape` failed (exit 1))" in line


def test_run_pipeline_calls_the_failure_recorder_once(tmp_path):
    seen = []

    def recorder(failure):
        seen.append(failure)
        return f"- pipeline_runs: recorded {failure.run_id} {failure.stage}"

    stages = [
        run_daily.Stage("scrape", [sys.executable, "-c", "print('scrape failed: blocked'); import sys; sys.exit(1)"]),
        run_daily.Stage("clean", [sys.executable, "-c", "print('must-not-run')"]),
    ]
    rc = run_daily.run_pipeline(stages, "20990101-000003", root=tmp_path, on_failure=recorder)
    assert rc == 1
    assert len(seen) == 1
    assert (seen[0].run_id, seen[0].stage, seen[0].exit_code) == (
        "20990101-000003", "scrape", 1,
    )
    assert seen[0].detail == "scrape failed: blocked"  # last output line, for the note
    log = (tmp_path / "jobs" / "20990101-000003" / "run_log.md").read_text(encoding="utf-8")
    assert "- pipeline_runs: recorded 20990101-000003 scrape" in log
    # ...and it sits in the Summary block, beside the overall verdict
    assert log.index("| scrape | failed (exit 1) |") < log.index("pipeline_runs: recorded")


def test_run_pipeline_recorder_not_called_on_success(tmp_path):
    seen = []
    stages = [run_daily.Stage("scrape", [sys.executable, "-c", "print('ok')"])]
    rc = run_daily.run_pipeline(
        stages, "20990101-000004", root=tmp_path, on_failure=lambda f: seen.append(f) or ""
    )
    assert rc == 0
    assert seen == []


def test_run_pipeline_survives_a_raising_recorder(tmp_path):
    def explode(failure):
        raise RuntimeError("recorder blew up")

    stages = [run_daily.Stage("scrape", [sys.executable, "-c", "import sys; sys.exit(1)"])]
    rc = run_daily.run_pipeline(stages, "20990101-000005", root=tmp_path, on_failure=explode)
    assert rc == 1  # still the stage failure, not a crash
    log = (tmp_path / "jobs" / "20990101-000005" / "run_log.md").read_text(encoding="utf-8")
    assert "failure NOT recorded (RuntimeError: recorder blew up)" in log


def test_main_wires_the_ingestion_recorder(monkeypatch):
    """`main` (what CI runs) must pass the real recorder — a wiring regression
    here silently returns the invisibility of failed runs."""
    wired = {}

    def fake_pipeline(stages, run_id, root, *, on_failure=None):
        wired["on_failure"] = on_failure
        return 0

    monkeypatch.setattr(run_daily, "run_pipeline", fake_pipeline)
    monkeypatch.setattr(run_daily, "load_local_env", lambda root=None: [])
    monkeypatch.setattr(run_daily, "build_stages", lambda *a, **k: [])
    assert run_daily.main(["--run-id", "20990101-000009"]) == 0
    assert wired["on_failure"] is ingestion.record_ingestion_failure


def test_load_local_env_does_not_override_real_env(monkeypatch, tmp_path):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "demo.local.env").write_text("DEMO_FROM_FILE=yes\n", encoding="utf-8")
    monkeypatch.setenv("DEMO_FROM_FILE", "from_real_env")
    loaded = run_daily.load_local_env(tmp_path)
    assert loaded == [cfg / "demo.local.env"]
    import os

    assert os.environ["DEMO_FROM_FILE"] == "from_real_env"
