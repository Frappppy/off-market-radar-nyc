"""tests scripts/run_daily.py: stage commands, skip logic, run_log.md (no scraping)."""

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


def test_utc_run_id_format():
    run_id = run_daily.utc_run_id()
    assert re.fullmatch(r"\d{8}-\d{6}", run_id), run_id


def test_build_stages_matches_contract():
    stages = run_daily.build_stages("20261014-143000", pages=5, max_details=150)
    assert [s.name for s in stages] == ["scrape", "clean", "store"]
    scrape, clean, store = (s.cmd for s in stages)
    assert scrape == [
        sys.executable, "-m", "src.scrape",
        "--pages", "5", "--max-details", "150", "--out", "jobs/20261014-143000/raw",
    ]
    assert clean == [
        sys.executable, "-m", "src.clean",
        "--in", "jobs/20261014-143000/raw", "--out", "jobs/20261014-143000/cleaned",
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


def test_load_local_env_does_not_override_real_env(monkeypatch, tmp_path):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "demo.local.env").write_text("DEMO_FROM_FILE=yes\n", encoding="utf-8")
    monkeypatch.setenv("DEMO_FROM_FILE", "from_real_env")
    loaded = run_daily.load_local_env(tmp_path)
    assert loaded == [cfg / "demo.local.env"]
    import os

    assert os.environ["DEMO_FROM_FILE"] == "from_real_env"
