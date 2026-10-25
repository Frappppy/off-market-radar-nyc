"""WHAT:      src.store.db guards — DSN redaction (never leak a password into
           logs or error messages), DATABASE_URL resolution (env beats the
           config file; fail fast with an actionable message), and the
           statement shapes the I12 contract pins (13/12 placeholders).
WHY:       Connection handling and credential redaction run on every load and
           otherwise fail silently until production; the statement shapes are
           the bridge between mapping.py and schema.sql.
INPUTS:    monkeypatched env / tmp_path files + src.store.db (no live DB).
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
"""

import pytest

from src.store import StoreError, db


def test_redact_dsn_strips_password():
    dsn = "postgresql://alice:s3cr3t-Pw@db.example.com:5432/neondb?sslmode=require"
    redacted = db.redact_dsn(dsn)
    assert "s3cr3t-Pw" not in redacted
    assert "alice:***@" in redacted
    assert "db.example.com" in redacted


def test_redact_dsn_applied_to_free_text():
    msg = "failed to connect: postgres://user:hunter2@host/db after 3 retries"
    cleaned = db.redact_dsn(msg)
    assert "hunter2" not in cleaned
    assert "user:***@" in cleaned


def test_get_database_url_missing_fails_fast(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(db, "_DEFAULT_ENV_FILE", tmp_path / "absent.local.env")
    with pytest.raises(StoreError) as excinfo:
        db.get_database_url()
    message = str(excinfo.value)
    assert "DATABASE_URL is not set" in message
    assert "config/database.local.env" in message
    assert "sslmode=require" in message  # shows the expected format, no real value


def test_get_database_url_prefers_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    monkeypatch.setattr(db, "_DEFAULT_ENV_FILE", tmp_path / "absent.local.env")
    assert db.get_database_url() == "postgresql://u:p@localhost/db"


def test_get_database_url_reads_local_env_file(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    env_file = tmp_path / "database.local.env"
    env_file.write_text("DATABASE_URL=postgresql://u:p@localhost/neon\n", encoding="utf-8")
    monkeypatch.setattr(db, "_DEFAULT_ENV_FILE", env_file)
    assert db.get_database_url().endswith("/neon")


def test_statement_builder_shapes():
    for stmt in (db._INSERT_LISTING, db._INSERT_SNAPSHOT):
        assert stmt.count("%s") == (13 if stmt is db._INSERT_LISTING else 12)
        assert "EXCLUDED." in stmt
    assert "first_seen_at" not in db._INSERT_LISTING.split("DO UPDATE", 1)[1]
    assert "last_seen_at" in db._INSERT_LISTING
