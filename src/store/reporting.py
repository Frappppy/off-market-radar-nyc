"""Stage-3 evidence files: <out>/manifest.json and <out>/process_log.md."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.isoformat(timespec="seconds")


def write_manifest(out_dir: Path, payload: dict) -> Path:
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def append_log(log_path: Path, text: str | list[str]) -> None:
    if isinstance(text, list):
        text = "\n".join(str(line) for line in text)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(text.rstrip("\n") + "\n")
