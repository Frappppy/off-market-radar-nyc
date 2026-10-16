"""src.store CLI failure paths (no live DB) — exit codes and messages."""

import pandas as pd
import pytest

from src.store import cli, db


@pytest.fixture(autouse=True)
def _no_local_env_file(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "_DEFAULT_ENV_FILE", tmp_path / "absent.local.env")


def test_missing_database_url_exits_2(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    rc = cli.main(["--in", "jobs/whatever/cleaned"])
    captured = capsys.readouterr()
    assert rc == 2
    assert "DATABASE_URL is not set" in captured.err
    assert "config/database.local.env" in captured.err


def test_missing_input_dir_exits_2(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    rc = cli.main(["--in", str(tmp_path / "nope")])
    captured = capsys.readouterr()
    assert rc == 2
    assert "input directory not found" in captured.err


def test_empty_input_dir_exits_2(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    rc = cli.main(["--in", str(tmp_path)])
    captured = capsys.readouterr()
    assert rc == 2
    assert "no listings_" in captured.err


def test_missing_required_columns_exits_2(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    pd.DataFrame({"source": ["zillow"]}).to_parquet(
        tmp_path / "listings_2026-10-14.parquet", index=False
    )
    rc = cli.main(["--in", str(tmp_path)])
    captured = capsys.readouterr()
    assert rc == 2
    assert "missing column" in captured.err


def test_resolve_run_id_precedence(tmp_path):
    from pathlib import Path

    cleaned = tmp_path / "20261014-143000" / "cleaned"
    assert cli.resolve_run_id("explicit-1", cleaned, {"run_id": "from-manifest"}) == "explicit-1"
    assert cli.resolve_run_id(None, cleaned, {"run_id": "from-manifest"}) == "from-manifest"
    assert cli.resolve_run_id(None, cleaned, {}) == "20261014-143000"
    loose = Path(str(tmp_path))
    assert cli.resolve_run_id(None, loose, {})


def test_resolve_records_scraped(tmp_path):
    import json

    assert cli.resolve_records_scraped(tmp_path) is None
    cleaned = tmp_path / "cleaned"
    cleaned.mkdir()
    (cleaned / "manifest.json").write_text(json.dumps({"records_in": 7}), encoding="utf-8")
    assert cli.resolve_records_scraped(cleaned) == 7
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "manifest.json").write_text(json.dumps({"records_out": 9}), encoding="utf-8")
    assert cli.resolve_records_scraped(cleaned) == 9  # raw manifest wins
