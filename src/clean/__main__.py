"""WHAT:      ``python -m src.clean`` entry point — delegates to ``cli.main``.
WHY:        ``-m`` execution needs a package ``__main__``; keeping it to a shim
            means the CLI contract (args, exit codes) lives only in ``cli.py``.
INPUTS:     ``sys.argv`` (via ``cli.main``).
OUTPUTS:    Process exit code (0 success; 1 failure).
CALLERS:    ``python -m src.clean``; ``scripts/run_daily.py``.
TESTED BY:  ``tests/test_clean.py::test_python_dash_m_module_invocation``
            (executes this module in a subprocess),
            ``tests/test_run_daily.py::test_build_stages_matches_contract``.
"""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
