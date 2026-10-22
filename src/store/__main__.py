"""WHAT:      ``python -m src.store`` entry point — delegates to ``cli.main``.
WHY:        ``-m`` execution needs a package ``__main__``; keeping it to a shim
            means the CLI contract (args, exit codes) lives only in ``cli.py``.
INPUTS:     ``sys.argv`` (via ``cli.main``).
OUTPUTS:    Process exit code (0 success; 1 load failure; 2 config/input).
CALLERS:    ``python -m src.store``; ``scripts/run_daily.py``.
TESTED BY:  ``tests/test_run_daily.py::test_build_stages_matches_contract``
            pins the ``-m src.store`` invocation shape (not its execution).
"""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
