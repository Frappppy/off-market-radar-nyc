"""WHAT:      ``python -m src.scrape`` entry point — delegates to ``cli.main``.
WHY:        ``-m`` execution needs a package ``__main__``; keeping it to two
            lines means the CLI contract (args, defaults, exit codes) lives in
            exactly one place: ``cli.py`` (I7).
INPUTS:     ``sys.argv`` (via ``cli.main``).
OUTPUTS:    Process exit code (0 success; 1 fatal error / CAPTCHA abort).
CALLERS:    ``python -m src.scrape``; ``scripts/run_daily.py``.
TESTED BY:  ``tests/test_run_daily.py::test_build_stages_matches_contract``
            pins the ``-m src.scrape`` invocation shape (not its execution).
"""

from .cli import main

raise SystemExit(main())
