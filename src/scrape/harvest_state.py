"""WHAT:      Harvest state + evidence IO — the resumable shard ledger
           (``harvest_state.json``), the append-only ``listings.jsonl``, and the
           per-run audit/manifest files.
WHY:        A 550-page, ~1-hour run must survive a crash, a proxy rotation or a
           manual CAPTCHA pause without losing pages. Every page updates the
           ledger and flushes its rows, so resuming is "read ledger, skip done".
INPUTS:     Output dir, shard identity, records.
OUTPUTS:    ``HarvestState`` (load/save/mark), ``append_records``,
           ``read_records``, ``write_json``, ``write_log``.
CALLERS:    ``src.scrape.harvest``.
TESTED BY:  ``tests/test_harvest.py`` (round-trip, dedupe seed, shard marks).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ..common.timeutil import utc_now_iso

STATE_FILE = "harvest_state.json"
LISTINGS_FILE = "listings.jsonl"
PATCH_FILE = "details_patch.jsonl"


def load_zips(path):
    """``zip,borough`` CSV -> ordered list of (zip, borough)."""
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines()[1:]:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        zip_code, borough = (part.strip() for part in line.split(",", 1))
        if zip_code:
            rows.append((zip_code, borough))
    return rows


def shard_url(borough, zip_code):
    return f"https://www.zillow.com/{borough}-ny-{zip_code}/"


def _new_shard(zip_code, borough):
    return {
        "zip": zip_code,
        "borough": borough,
        "status": "pending",
        "pages": 0,
        "total": None,
        "listings": 0,
        "next_url": shard_url(borough, zip_code),
        "last_error": None,
        "updated_at": None,
    }


def read_records(path):
    """Existing rows keyed by ``listing_id`` (crash-safe dedupe seed)."""
    records = {}
    path = Path(path)
    if not path.exists():
        return records
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # a torn final line from a hard kill
            listing_id = row.get("listing_id")
            if listing_id:
                records[str(listing_id)] = row
    return records


def append_records(path, records):
    """Append rows and fsync, so a kill never loses a completed page."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def rewrite_records(path, records):
    """Atomic full rewrite (detail-enrichment pass)."""
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def apply_patch(records, path):
    """Overlay an append-only detail patch onto the row map (last row wins).

    The detail pass writes each enriched row here *before* marking its zpid
    done, so a hard kill can lose at most the row being written — never a row
    whose id is already in ``details_done.txt``. Returns rows applied.
    """
    applied = 0
    path = Path(path)
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            listing_id = row.get("listing_id")
            if listing_id:
                records[str(listing_id)] = row
                applied += 1
    return applied


class HarvestState:
    def __init__(self, path, data):
        self.path = Path(path)
        self.data = data

    @classmethod
    def load(cls, path, shards):
        path = Path(path)
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                for zip_code, borough in shards:
                    data.setdefault("shards", {}).setdefault(
                        zip_code, _new_shard(zip_code, borough))
                return cls(path, data)
            except (OSError, json.JSONDecodeError, AttributeError):
                pass
        data = {
            "version": 1,
            "started_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "shards": {zip_code: _new_shard(zip_code, borough)
                       for zip_code, borough in shards},
        }
        state = cls(path, data)
        state.save()
        return state

    def save(self):
        self.data["updated_at"] = utc_now_iso()
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.data, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)

    def shard(self, zip_code):
        return self.data["shards"][zip_code]

    def mark(self, zip_code, **fields):
        entry = self.data["shards"][zip_code]
        entry.update(fields)
        entry["updated_at"] = utc_now_iso()
        self.save()

    def pending(self):
        return [
            entry for entry in self.data["shards"].values()
            if entry["status"] not in ("done",)
        ]

    def counts(self):
        shards = self.data["shards"].values()
        return {
            "done": sum(1 for s in shards if s["status"] == "done"),
            "failed": sum(1 for s in shards if s["status"] == "failed"),
            "total": len(self.data["shards"]),
        }


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
