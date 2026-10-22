"""WHAT:      Full src.store CLI flow against a FakeConn (no live DB) —
           transaction boundaries, pipeline_runs lifecycle (start/finish,
           success and failed), stale-marking invocation, --skip-schema, and
           the manifest / process_log.md evidence written per run.
WHY:       The CLI is where all-or-nothing semantics and evidence writing are
           decided; a rollback bug or an unlogged failure would corrupt the
           freshness data the site trusts. Every collaborator is monkeypatched,
           so the tests are deterministic, offline and fast.
INPUTS:    tmp_path parquet fixtures + src.store.{cli,db} with fakes.
OUTPUTS:   pytest verdicts only; store/ artifacts inside tmp_path.
CALLERS:   `python -m pytest` — suite baseline: 155 passed, 2 skipped.
"""

import json

import pandas as pd
import pytest

from src.store import cli, db


class FakeConn:
    def __init__(self):
        self.rolled_back = 0
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def rollback(self):
        self.rolled_back += 1

    def transaction(self):
        """Mimic psycopg3 Connection.transaction(): commit/rollback scope
        that does NOT close the connection (unlike __exit__ in 3.3.6)."""
        conn = self

        class _Txn:
            def __enter__(self):
                return conn

            def __exit__(self, *exc):
                return False

        return _Txn()

    def close(self):
        self.closed = True


@pytest.fixture
def instrument(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    monkeypatch.setattr(db, "_DEFAULT_ENV_FILE", tmp_path / "absent.local.env")
    calls = {"started": [], "finished": [], "listings": 0, "snapshots": 0, "stale": []}

    conn = FakeConn()
    monkeypatch.setattr(cli, "connect", lambda dsn: conn)
    monkeypatch.setattr(cli, "apply_schema", lambda c: None)
    monkeypatch.setattr(
        cli, "start_pipeline_run", lambda c, rid, src: calls["started"].append((rid, src))
    )
    monkeypatch.setattr(
        cli,
        "finish_pipeline_run",
        lambda c, rid, status, scraped, loaded, notes: calls["finished"].append(
            (rid, status, scraped, loaded, notes)
        ),
    )
    monkeypatch.setattr(cli, "upsert_listings", lambda c, rows: len(rows))
    monkeypatch.setattr(cli, "upsert_snapshots", lambda c, rows: len(rows))

    def _fake_mark_stale(c):
        calls["stale"].append(c)
        return 4  # deterministic count for the process_log evidence line

    monkeypatch.setattr(cli, "mark_stale_listings", _fake_mark_stale)
    return calls, conn


def _write_cleaned(tmp_path, rows=2):
    cleaned = tmp_path / "20261014-143000" / "cleaned"
    cleaned.mkdir(parents=True)
    data = [
        {
            "source": "zillow",
            "listing_id": str(i),
            "url": "https://www.zillow.com/homedetails/x/",
            "address_std": f"{i} MAIN ST",
            "city": "New York",
            "state": "NY",
            "zip": "10001",
            "latitude": 40.7,
            "longitude": -74.0,
            "price_current": 500000 + i,
            "price_reduced": True,
            "property_type": "condo",
            "bedrooms": 2.0,
            "bathrooms": 1.0,
            "living_area_sqft": 1000,
            "days_on_market": 95,
            "scraped_at": "2026-10-14T14:30:00+00:00",
            "snapshot_date": "2026-10-14",
            "price_per_sqft": 500.0,
            "price_drop_pct": 6.0,
            "motivation_score": "High",
            "motivation_reason": "DOM=95>90 AND drop=6.0%>5",
        }
        for i in range(rows)
    ]
    pd.DataFrame(data).to_parquet(cleaned / "listings_2026-10-14.parquet", index=False)
    return cleaned


def test_success_flow(instrument, tmp_path):
    calls, conn = instrument
    cleaned = _write_cleaned(tmp_path)
    out = cleaned.parent / "store"
    rc = cli.main(["--in", str(cleaned), "--out", str(out)])

    assert rc == 0
    assert calls["started"] == [("20261014-143000", "zillow")]  # run_id from parent dir
    assert calls["finished"] == [("20261014-143000", "success", None, 2, None)]
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest == {
        "stage": "store",
        "run_id": "20261014-143000",
        "records_in": 2,
        "records_out": 2,
        "started_at": manifest["started_at"],
        "finished_at": manifest["finished_at"],
        "status": "success",
    }
    assert manifest["started_at"] and manifest["finished_at"]
    log = (out / "process_log.md").read_text(encoding="utf-8")
    assert "status `running` -> `success`" in log
    assert "listing_snapshots upserted" in log
    assert "listings marked inactive (missed 3 consecutive successful runs): 4" in log
    assert "DATABASE_URL (value never logged)" in log
    assert "postgresql://" not in log
    assert conn.closed
    assert calls["stale"] == [conn]  # stale-marking runs after the success marker


def test_failure_flow_marks_failed(instrument, tmp_path, monkeypatch, capsys):
    calls, conn = instrument
    cleaned = _write_cleaned(tmp_path)
    out = cleaned.parent / "store"

    def boom(c, rows):
        raise RuntimeError("relation listing_snapshots does not exist")

    monkeypatch.setattr(cli, "upsert_snapshots", boom)
    rc = cli.main(["--in", str(cleaned), "--out", str(out)])

    assert rc == 1
    assert calls["finished"] == [
        ("20261014-143000", "failed", None, 0, "RuntimeError: relation listing_snapshots does not exist")
    ]
    assert conn.rolled_back == 1
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "failed"
    assert manifest["records_out"] == 0
    err = capsys.readouterr().err
    assert "relation listing_snapshots does not exist" in err
    assert conn.closed


def test_records_scraped_from_raw_manifest(instrument, tmp_path):
    calls, _ = instrument
    cleaned = _write_cleaned(tmp_path)
    raw = cleaned.parent / "raw"
    raw.mkdir()
    (raw / "manifest.json").write_text(json.dumps({"records_out": 42}), encoding="utf-8")
    out = cleaned.parent / "store"
    rc = cli.main(["--in", str(cleaned), "--out", str(out)])
    assert rc == 0
    assert calls["finished"][0][2] == 42  # records_scraped


def test_skip_schema_flag(instrument, tmp_path, monkeypatch):
    calls, _ = instrument
    applied = []
    monkeypatch.setattr(cli, "apply_schema", lambda c: applied.append(1))
    cleaned = _write_cleaned(tmp_path)
    rc = cli.main(["--in", str(cleaned), "--out", str(cleaned.parent / "store"), "--skip-schema"])
    assert rc == 0
    assert applied == []  # skipped
    rc = cli.main(["--in", str(cleaned), "--out", str(cleaned.parent / "store")])
    assert rc == 0
    assert applied == [1]  # applied by default
