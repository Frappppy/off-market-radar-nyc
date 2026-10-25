"""WHAT:      `python -m src.store --record-failure` — the orchestrator's only
           channel into `pipeline_runs` for a run that never reached the normal
           load stage: it writes the failed run row and nothing else.
WHY:       When stage 1 or 2 dies, `scripts/run_daily.py` skips stage 3 — and
           stage 3 is the only writer of `pipeline_runs`. Before this mode the
           database kept saying "yesterday" forever and the site's freshness
           guard (invariant I3) had nothing to report, so a broken pipeline
           looked like a quiet market. These tests pin the repair: one row,
           status `failed`, honest `started_at`, DSN never in the note, no
           evidence files, no input reads.
INPUTS:    monkeypatched `src.store.record.connect/record_failed_run` + the
           FakeConn from tests/test_store_flow.py (imported, not duplicated —
           the two modules test the same CLI and the fake is 40 lines).
OUTPUTS:   pytest verdicts only; the `--record-failure` argv path through
           `cli.main` against fakes.
CALLERS:   `python -m pytest`. Split out of tests/test_store_flow.py on
           2026-10-25 when that file passed the 300-line hard cap
           (docs/decisions.md §7); the flow tests stayed there.
Verified by: test_record_failure_mode_writes_only_the_run_row and the three
           siblings below (each pins one branch of `--record-failure`).
"""

import pytest

from src.store import cli, db, record
from test_store_flow import FakeConn


@pytest.fixture
def record_env(monkeypatch, tmp_path):
    """Fake DB for record mode; returns (conn, calls written)."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    monkeypatch.setattr(db, "_DEFAULT_ENV_FILE", tmp_path / "absent.local.env")
    conn = FakeConn()
    calls = []
    monkeypatch.setattr(record, "connect", lambda dsn: conn)
    monkeypatch.setattr(
        record,
        "record_failed_run",
        lambda c, rid, **kw: calls.append((rid, kw)),
    )
    return conn, calls


def test_record_failure_mode_writes_only_the_run_row(record_env, tmp_path, capsys):
    conn, calls = record_env
    rc = cli.main([
        "--record-failure", "--run-id", "20261020-101500",
        "--note", "stage `scrape` failed (exit 1): scrape failed: blocked",
    ])
    assert rc == 0
    assert calls == [
        (
            "20261020-101500",
            {
                "source": None,
                "note": "stage `scrape` failed (exit 1): scrape failed: blocked",
                # the run_id itself is the UTC start, so the row is honest about
                # when the run began, not when the recorder got to it
                "started_at": record.run_id_started_at("20261020-101500"),
            },
        )
    ]
    assert conn.closed
    out = capsys.readouterr().out
    assert "pipeline_runs 20261020-101500 -> failed" in out
    assert "postgresql://" not in out + capsys.readouterr().err
    # no input files were read, no evidence written: nothing under tmp_path
    assert list(tmp_path.iterdir()) == []


def test_record_failure_mode_requires_a_run_id(record_env, capsys):
    conn, calls = record_env
    assert cli.main(["--record-failure"]) == 2
    assert calls == []
    assert "--run-id" in capsys.readouterr().err
    assert not conn.closed  # never even connected


def test_record_failure_note_is_redacted_and_capped(record_env, monkeypatch):
    conn, calls = record_env
    seen = {}

    def spy(c, rid, **kw):
        seen.update(kw)

    monkeypatch.setattr(record, "record_failed_run", spy)
    long_note = "x " * 600  # 1199 chars when collapsed
    rc = cli.main(
        ["--record-failure", "--run-id", "20261020-101500", "--note", long_note]
    )
    assert rc == 0
    assert len(seen["note"]) == record.NOTE_LIMIT
    assert "\n" not in seen["note"] and "  " not in seen["note"]
    # db-side redaction is what keeps a DSN out of the notes column
    assert db.redact_dsn("postgresql://u:s3cr3t@host/db") == "postgresql://u:***@host/db"


def test_record_failure_database_error_exits_1(record_env, monkeypatch, capsys):
    conn, _ = record_env
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")

    def boom(c, rid, **kw):
        raise RuntimeError('relation "pipeline_runs" does not exist')

    monkeypatch.setattr(record, "record_failed_run", boom)
    rc = cli.main(["--record-failure", "--run-id", "20261020-101500", "--note", "n"])
    assert rc == 1
    assert "could not record failure" in capsys.readouterr().err
    assert conn.closed  # the connection is still released


def test_run_id_started_at_is_the_utc_moment_the_id_encodes():
    from datetime import datetime, timezone

    assert record.run_id_started_at("20261020-101500") == datetime(
        2026, 10, 20, 10, 15, 0, tzinfo=timezone.utc
    )
    # a non-conforming id gives up and lets the SQL use now()
    assert record.run_id_started_at("today") is None
