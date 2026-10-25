"""WHAT:      Stage-2 process-log writers — the success ``process_log.md``
           builder, the failure log, and the best-effort failed-run manifest.
WHY:        Split (phase 2) from the 293-line ``clean/cli.py`` (gate fix: no
           file >200 lines); ``cli.main`` stays the argparse entry point.
           Bodies and log text moved verbatim.
INPUTS:     ``CleanStats`` + run metadata (run_id, times, input/out paths,
            per-file sizes, fallback note) passed by ``cli.main``.
OUTPUTS:    ``process_log.md`` text (success and failure variants);
            ``manifest.json`` written best-effort on failure.
CALLERS:    ``src.clean.cli`` (``_build_log``, ``_write_failure_artifacts``).
"""

from __future__ import annotations

from pathlib import Path

from ..common.evidence import write_manifest
from ..common.timeutil import utc_now_iso
from .derive import CleanStats

# --- manifest keys -----------------------------------------------------------

MANIFEST_KEYS = (
    "stage",
    "run_id",
    "records_in",
    "records_out",
    "started_at",
    "finished_at",
    "status",
)


# --- success log builder -----------------------------------------------------


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
        "## Sanitize",
    ]
    if stats.guards is None:
        lines.append("- not applied (pass `--sanitize` to enable)")
    else:
        guards = stats.guards
        lines += [
            f"- dropped {guards.get('zero_price', 0)} row(s) with price_current "
            "missing or <= 0 (auction / 'contact for price' cards carry no signal)",
            f"- dropped {guards.get('out_of_market', 0)} row(s) whose state is "
            "set and is not NY (nearby-home padding from Zillow's ZIP pages)",
            f"- nulled price_previous on {guards.get('implausible_previous', 0)} "
            "row(s) where the prior price exceeded 5x the current price (parse "
            "artefact); the row keeps its DOM, price and location",
        ]
    lines += [
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


# --- failure log + best-effort manifest --------------------------------------


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
        manifest: dict[str, str | None] = {key: None for key in MANIFEST_KEYS}
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
        write_manifest(out_dir, manifest)
        (out_dir / "process_log.md").write_text(
            _failed_log(run_id, started_at, input_path, error), encoding="utf-8",
            newline="\n"
        )
    except OSError:
        pass  # best effort only — the primary error is already reported
