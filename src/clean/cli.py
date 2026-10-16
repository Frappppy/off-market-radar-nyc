"""CLI for stage 2 (clean): ``python -m src.clean --in <raw> --out <cleaned>``.

Reads ``jobs/<run_id>/raw/listings.jsonl`` and writes
``listings_<snapshot_date>.parquet`` + the same ``.csv``, plus
``manifest.json`` and ``process_log.md`` (docs/data_contract.md).
Exit code 0 = success.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from .core import RUN_ID_RE, CleanStats, clean_file, utc_now_iso

MANIFEST_KEYS = (
    "stage",
    "run_id",
    "records_in",
    "records_out",
    "started_at",
    "finished_at",
    "status",
)


def resolve_input(value: str) -> Path:
    """``--in`` accepts the raw dir (jobs/<run_id>/raw) or a .jsonl file."""
    path = Path(value)
    if path.is_dir():
        candidate = path / "listings.jsonl"
        if not candidate.is_file():
            raise FileNotFoundError(f"raw file not found: {candidate}")
        return candidate
    if path.is_file():
        return path
    raise FileNotFoundError(f"input not found: {path}")


def resolve_run_id(explicit: str | None, input_path: Path) -> str:
    if explicit:
        return explicit
    raw_dir = input_path.parent
    manifest_path = raw_dir / "manifest.json"
    if manifest_path.is_file():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {}
        value = data.get("run_id")
        if isinstance(value, str) and value:
            return value
    parent = raw_dir.parent.name
    return parent if RUN_ID_RE.match(parent) else "unknown"


def _build_log(
    *,
    run_id: str,
    started_at: str,
    finished_at: str,
    input_path: Path,
    out_dir: Path,
    stats: CleanStats,
    files: list[tuple[str, int, int]],
    fallback_note: str | None,
) -> str:
    dropped_note = (
        ", ".join(f"`{c}`" for c in stats.dropped_columns)
        if stats.dropped_columns
        else "none"
    )
    extras_note = (
        ", ".join(f"`{c}`" for c in stats.extra_columns)
        if stats.extra_columns
        else "none"
    )
    lines = [
        "# process log — stage 2 (clean)",
        "",
        f"- `run_id`: `{run_id}`",
        f"- `started_at`: {started_at}",
        f"- input: `{input_path}`",
        f"- output dir: `{out_dir}`",
        "",
        "## Read",
        f"- non-blank lines: {stats.lines}; records parsed: {stats.records_in}; "
        f"malformed lines skipped: {stats.skipped_lines}",
        f"- extra scraper columns passed through: {extras_note}",
        f"- nested columns dropped from tabular output (raw JSONL keeps the "
        f"audit trail): {dropped_note} — present in {stats.price_history_rows} rows",
        "",
        "## Transform",
        "- `address_std`: uppercase, whitespace collapsed, trimmed "
        "(missing address stays null)",
        "- `snapshot_date`: UTC date parsed from `scraped_at` "
        f"({stats.distinct_snapshot_dates} distinct date(s) in this run; "
        f"file named for the majority date)",
    ]
    if fallback_note:
        lines.append(f"- WARNING: {fallback_note}")
    lines += [
        "- `price_per_sqft` = price_current / living_area_sqft "
        "(null when sqft is null or 0)",
        "- `price_drop_abs` = price_previous - price_current; "
        "`price_drop_pct` = abs / previous * 100 (null if either is missing)",
        "- `motivation_score`: High = DOM>90 AND drop>5%; Medium = not High AND "
        "(DOM>90 OR drop>5%); Low otherwise — missing DOM treated as <=90, "
        "missing drop as <=5%",
        "- `price_reduced`: site flag OR price_previous > price_current "
        f"({stats.reduced_flag_missing} row(s) had no boolean site flag)",
    ]
    if stats.unknown_property_types:
        lines.append(
            "- WARNING: property_type values outside the contract enum: "
            + ", ".join(f"`{v}`" for v in stats.unknown_property_types)
            + " (passed through unchanged)"
        )
    lines += [
        "",
        "## Write",
    ]
    for name, rows, size in files:
        lines.append(f"- `{name}` — {rows} rows, {size} bytes")
    lines.append("- `manifest.json`")
    lines += [
        "",
        "## Result",
        f"- `finished_at`: {finished_at}",
        f"- records_in: {stats.records_in}; records_out: {stats.records_out}",
        "- status: `success`",
        "",
    ]
    return "\n".join(lines)


def _failed_log(run_id: str, started_at: str, input_path: Path, error: str) -> str:
    return "\n".join(
        [
            "# process log — stage 2 (clean)",
            "",
            f"- `run_id`: `{run_id}`",
            f"- `started_at`: {started_at}",
            f"- input: `{input_path}`",
            "",
            "## Error",
            "```",
            error.rstrip(),
            "```",
            "",
            "## Result",
            "- status: `failed`",
            "",
        ]
    )


def _write_failure_artifacts(out_dir: Path, run_id: str, started_at: str, input_path: Path, error: str) -> None:
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest = {key: None for key in MANIFEST_KEYS}
        manifest.update(
            {
                "stage": "clean",
                "run_id": run_id,
                "records_in": None,
                "records_out": None,
                "started_at": started_at,
                "finished_at": utc_now_iso(),
                "status": "failed",
            }
        )
        (out_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        (out_dir / "process_log.md").write_text(
            _failed_log(run_id, started_at, input_path, error), encoding="utf-8"
        )
    except OSError:
        pass  # best effort only — the primary error is already reported


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m src.clean",
        description=(
            "Stage 2 (clean): raw listings.jsonl -> typed, motivation-scored "
            "parquet + csv (+ manifest.json, process_log.md)"
        ),
    )
    parser.add_argument(
        "--in",
        dest="in_path",
        required=True,
        metavar="DIR",
        help="raw dir (jobs/<run_id>/raw) or a listings .jsonl file",
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        required=True,
        metavar="DIR",
        help="cleaned output dir (jobs/<run_id>/cleaned)",
    )
    parser.add_argument(
        "--run-id",
        dest="run_id",
        default=None,
        help="override the run_id written to manifest.json",
    )
    args = parser.parse_args(argv)

    started_at = utc_now_iso()
    out_dir = Path(args.out_path)

    try:
        input_path = resolve_input(args.in_path)
    except FileNotFoundError as exc:
        print(f"clean failed: {exc}", file=sys.stderr)
        return 1

    run_id = resolve_run_id(args.run_id, input_path)

    try:
        frame, stats = clean_file(input_path)
        fallback_note = None
        snapshot = stats.snapshot_date
        if snapshot is None:
            snapshot = datetime.now(timezone.utc).date()
            fallback_note = (
                "no valid `scraped_at` dates — using the current UTC date for "
                "the output filename; `snapshot_date` is null on every row"
            )

        out_dir.mkdir(parents=True, exist_ok=True)
        stem = f"listings_{snapshot.isoformat()}"
        parquet_path = out_dir / f"{stem}.parquet"
        csv_path = out_dir / f"{stem}.csv"
        frame.to_parquet(parquet_path, index=False)
        frame.to_csv(csv_path, index=False)

        files = [
            (parquet_path.name, len(frame), parquet_path.stat().st_size),
            (csv_path.name, len(frame), csv_path.stat().st_size),
        ]
        manifest = {
            "stage": "clean",
            "run_id": run_id,
            "records_in": stats.records_in,
            "records_out": stats.records_out,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "status": "success",
        }
        (out_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        (out_dir / "process_log.md").write_text(
            _build_log(
                run_id=run_id,
                started_at=started_at,
                finished_at=manifest["finished_at"],
                input_path=input_path,
                out_dir=out_dir,
                stats=stats,
                files=files,
                fallback_note=fallback_note,
            ),
            encoding="utf-8",
        )
        print(
            f"clean: {stats.records_out} records -> {parquet_path} "
            f"(+ .csv, manifest.json, process_log.md)"
        )
        if stats.skipped_lines:
            print(
                f"clean: skipped {stats.skipped_lines} malformed line(s), "
                f"see {out_dir / 'process_log.md'}",
                file=sys.stderr,
            )
        return 0
    except Exception:
        error = traceback.format_exc()
        _write_failure_artifacts(out_dir, run_id, started_at, input_path, error)
        print(f"clean failed: {error.strip().splitlines()[-1]}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
