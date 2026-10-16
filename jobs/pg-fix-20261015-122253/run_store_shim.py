"""Runtime shim: run src.store with psycopg.Connection.__exit__ minus close().

psycopg 3.3.6 (pinned in requirements.txt) closes non-pooled connections on
__exit__ (upstream psycopg/connection.py:178-180); src/store/cli.py wraps four
transactions in `with conn:` on ONE connection, so transaction 1's exit kills
the connection and transaction 2 fails with "the connection is closed".
This patch exists only in this process; no repository file is modified.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import psycopg  # noqa: E402
import psycopg.connection  # noqa: E402


def _exit_no_close(self, exc_type, exc_val, exc_tb):
    """Upstream psycopg 3.3.6 Connection.__exit__ minus the final close()."""
    if self.closed:
        return
    if exc_type:
        try:
            self.rollback()
        except Exception as exc2:  # noqa: BLE001 - upstream warns and proceeds
            psycopg.connection.logger.warning(
                "error ignored in rollback on %s: %s", self, exc2
            )
    else:
        self.commit()


psycopg.Connection.__exit__ = _exit_no_close
print(
    "[shim] psycopg.Connection.__exit__ patched: commit/rollback WITHOUT close",
    file=sys.stderr,
)

sys.argv = ["src.store", *sys.argv[1:]]
runpy.run_module("src.store", run_name="__main__")
