"""WHAT:      The ingestion-health side of one daily run: ``RunFailure`` (which
           stage died, with what exit code and last output line), the note
           text it produces, and the best-effort subprocess that records it.
WHY:        Stage 3 is the only writer of ``pipeline_runs``, and a failed stage
           makes the orchestrator skip it — so without this the run leaves no
           database row and ``/api/health`` reports zero failures for a month of
           outages. The policy lives here (not inside ``scripts/run_daily.py``)
           because that script is already at the D1 line budget (docs/decisions
           .md §7) and this is a self-contained rule with its own tests.
INPUTS:     A ``RunFailure``; ``sys.executable`` + the repo root for the
           subprocess; no configuration of its own.
OUTPUTS:    ``record_ingestion_failure()`` -> one log line (never raises);
            ``record_failure_command()`` -> the argv list; NOTE_LIMIT caps text.
CALLERS:    ``scripts/run_daily.py`` (``main`` wires it as ``on_failure``).
TESTED BY:  ``tests/test_run_daily.py`` — note shape, command shape,
            best-effort behaviour, and the orchestrator's single call.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

#: `notes` is operator-facing text (the health card shows it), so it is capped
#: here as well as in `src.store.record`.
NOTE_LIMIT = 400

#: How long the stage-3 subprocess gets to reach the database.
RECORD_TIMEOUT_S = 180


@dataclass
class RunFailure:
    run_id: str
    stage: str
    exit_code: int
    detail: str | None  # last output line of the failing stage

    @property
    def note(self) -> str:
        return failure_note(self.stage, self.exit_code, self.detail)


def failure_note(stage: str, exit_code: int, detail: str | None) -> str:
    """``stage `scrape` failed (exit 1): scrape failed: …`` — one line, capped.

    The last output line is used because all three stages end a failure with
    their own reason line (``scrape failed:`` / ``clean failed:`` /
    ``src.store: ERROR:``), and each is secret-scrubbed at the source;
    ``src.store.db.record_failed_run`` redacts a DSN again before writing.
    Verified by: test_failure_note_names_the_stage_exit_and_last_line
    """
    note = f"stage `{stage}` failed (exit {exit_code})"
    if detail:
        note = f"{note}: {' '.join(detail.split())}"
    return note[:NOTE_LIMIT]


def record_failure_command(failure: RunFailure, *, interpreter: str = sys.executable) -> list[str]:
    """The stage-3 call that closes the loop for this run.
    Verified by: test_record_failure_command_shape
    """
    return [
        interpreter, "-m", "src.store", "--record-failure",
        "--run-id", failure.run_id, "--note", failure.note,
    ]


def record_ingestion_failure(failure: RunFailure) -> str:
    """Best effort: ask stage 3 to write the `failed` row; return the log line.

    Never raises and never changes the run's exit code — an unreachable
    database must not turn one failure into two. The statement it runs
    (``_RECORD_FAILURE``) leaves an already-finished row untouched, so this is
    safe even when the store stage failed and recorded itself.
    Verified by: test_record_ingestion_failure_is_best_effort
    """
    try:
        proc = subprocess.run(
            record_failure_command(failure),
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=RECORD_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return f"- pipeline_runs: failure NOT recorded ({exc})"
    if proc.returncode == 0:
        return f"- pipeline_runs: status `failed` recorded ({failure.note})"
    reason = " ".join((proc.stderr or proc.stdout or "").split())[:200]
    return f"- pipeline_runs: failure NOT recorded (exit {proc.returncode}): {reason}"


__all__ = [
    "NOTE_LIMIT",
    "RECORD_TIMEOUT_S",
    "RunFailure",
    "failure_note",
    "record_failure_command",
    "record_ingestion_failure",
]
