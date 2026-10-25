"""WHAT:      .github/workflows/ guards — daily_pipeline.yml exists at the repo
           root, references exactly the six allowed GitHub secrets (no leaked
           connection strings or values), keeps its cron and workflow_dispatch
           triggers, and invokes scripts/run_daily.py with the venv interpreter;
           checks.yml (below) keeps its five gates and its credential-free run,
           and the interpreter it pins is the interpreter pyproject.toml tells
           mypy and ruff to assume.
WHY:       The workflow holds the only production credentials in the repo; a
           leak or a silently edited stage would go unnoticed until the next
           10:00 UTC run. Parsed as text — no Actions runner needed.
INPUTS:    .github/workflows/{daily_pipeline,checks}.yml + requirements-dev.txt
           + requirements.txt + pyproject.toml (raw text/tomllib only).
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the suite count lives in tests/README.md, not
           here: a number inside a test docstring is the first thing to go stale.
"""

import importlib.util
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# This project folder is the repository root, so the workflow must live in its
# own .github/workflows/ (GitHub Actions only reads workflows from the root).
# Verified by: test_workflow_exists.
WORKFLOW = ROOT / ".github" / "workflows" / "daily_pipeline.yml"

ALLOWED_SECRETS = {
    "DATABASE_URL",
    "DATAIMPULSE_LOGIN",
    "DATAIMPULSE_PASSWORD",
    "DATAIMPULSE_HOST",
    "DATAIMPULSE_PORT",
    "DATAIMPULSE_COUNTRY",
}


def test_workflow_exists():
    assert WORKFLOW.is_file()


def test_only_the_six_secrets_referenced():
    text = WORKFLOW.read_text(encoding="utf-8")
    referenced = set(re.findall(r"\bsecrets\.([A-Za-z0-9_]+)", text))
    assert referenced == ALLOWED_SECRETS, referenced
    assert text.count("${{ secrets.") == 6


def test_no_leaked_values():
    text = WORKFLOW.read_text(encoding="utf-8")
    lowered = text.lower()
    assert "postgresql://" not in lowered  # no connection strings
    assert "sslmode=" not in lowered
    assert "gw.dataimpulse.com" not in lowered
    assert "password=" not in lowered and "pwd=" not in lowered
    # every ${{ }} expression is a secrets reference or empty — no inline values
    for expr in re.findall(r"\$\{\{([^}]+)\}\}", text):
        assert "secrets." in expr, expr


def test_schedule_and_stages():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert 'cron: "0 10 * * *"' in text
    assert "workflow_dispatch" in text
    assert "actions/checkout@v4" in text
    assert "actions/setup-python@v5" in text
    assert "py -3 -m venv .venv" in text
    assert "requirements.txt" in text
    assert "run_daily.py" in text
    assert ".venv\\Scripts\\python.exe -m pip install -r requirements.txt" in text
    assert ".venv\\Scripts\\python.exe scripts\\run_daily.py" in text
    # the project folder is the repo root, so paths are root-relative
    assert "Project 1 [" not in text


# ---------------------------------------------------------------------------
# checks.yml — the Phase-6 guardrail workflow (header check, pytest,
# verify_contract). Added with Phase 6; the daily_pipeline assertions above
# are untouched. All verified by: REFACTOR_PLAN §5 Phase 6 gate.
# ---------------------------------------------------------------------------
CHECKS_WORKFLOW = ROOT / ".github" / "workflows" / "checks.yml"


def test_checks_workflow_exists():
    assert CHECKS_WORKFLOW.is_file()


def test_checks_workflow_triggers_on_push_and_pull_request():
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    assert re.search(r"^on:\s*$", text, re.M)
    assert re.search(r"^  push:\s*$", text, re.M)
    assert re.search(r"^  pull_request:\s*$", text, re.M)


def test_checks_workflow_runs_the_three_gates():
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    assert "scripts/check_headers.py" in text        # (a) T0 header guardrail
    assert "-m pytest" in text                       # (b) test suite
    assert "dashboard/verify_contract.py" in text    # (c) data contract


def test_checks_workflow_header_step_invokes_script_by_path():
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    # the header step must EXECUTE the script, not just mention it in a comment
    assert re.search(r"run:.*scripts[/\\]check_headers\.py", text)


def test_checks_workflow_mirrors_daily_pipeline_install():
    # same pinned interpreter and venv install as daily_pipeline.yml
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    assert 'python-version: "3.14"' in text
    assert "actions/checkout@v4" in text
    assert "actions/setup-python@v5" in text
    assert ".venv\\Scripts\\python.exe -m pip install -r requirements.txt" in text


def test_checks_workflow_references_no_secrets():
    # checks need no credentials, so the workflow must reference none
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    assert "secrets." not in text
    assert "postgresql://" not in text.lower()
    assert "password=" not in text.lower()


# ---------------------------------------------------------------------------
# checks.yml static gates — ruff + mypy, added 2026-10-25 with
# requirements-dev.txt. The assertion is on the COMMAND, not on a step name, so
# renaming a step cannot silently turn a gate back into a comment.
# Verified by: test_checks_workflow_runs_the_static_gates,
#              test_requirements_dev_pins_the_two_tools.
# ---------------------------------------------------------------------------
REQ_DEV = ROOT / "requirements-dev.txt"


def test_checks_workflow_runs_the_static_gates():
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    assert "-m pip install -r requirements-dev.txt" in text
    assert re.search(r"run:.*-m ruff check src scripts tests dashboard", text)
    assert re.search(r"run:.*-m mypy src", text)


def test_requirements_dev_pins_the_two_tools():
    # pinned, not floating: a ruff/mypy minor release must not be able to turn a
    # green run red, and the file must stay installable on its own (-r runtime).
    text = REQ_DEV.read_text(encoding="utf-8")
    assert "-r requirements.txt" in text
    assert re.search(r"^mypy==\d", text, re.M)
    assert re.search(r"^ruff==\d", text, re.M)
    assert not re.search(r"^(requests|httpx|SQLAlchemy|beautifulsoup4|lxml)==", text, re.M)


def test_requirements_txt_has_no_unused_pins():
    # the six packages this file used to pin were installed and never imported;
    # a pin with no import behind it is an unpatched dependency, not a feature.
    text = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    for gone in ("requests", "httpx", "SQLAlchemy", "beautifulsoup4", "lxml"):
        assert not re.search(rf"^{gone}==", text, re.M), gone
    # ...and the runtime roots it does need are still pinned
    for kept in ("curl_cffi", "pandas", "playwright", "psycopg", "sqlglot", "pytest"):
        assert re.search(rf"^{kept}==", text, re.M | re.I), kept


# ---------------------------------------------------------------------------
# Interpreter-version drift — added 2026-10-25 after the first CI run that
# carried the mypy gate (40197244569) failed on it:
#
#   .venv\Lib\site-packages\numpy\__init__.pyi:737: error: Type statement is
#   only supported in Python 3.12 and greater   [syntax]
#   Found 1 error in 1 file (errors prevented further checking)
#
# checks.yml installs Python 3.14, but [tool.mypy] still declared 3.11, and
# numpy==2.5.4 ships PEP 695 `type` aliases in its stubs — below a 3.12 target
# mypy refuses to parse them and stops before reading src/ at all. The gate was
# red AND checked nothing, which is the worst of both. These three numbers
# (workflow pin, mypy target, ruff target) must move together; pinning them to
# each other is what keeps a "known-good" config from quietly rotting.
# Verified by: test_tool_versions_match_the_ci_interpreter.
# ---------------------------------------------------------------------------
PYPROJECT = ROOT / "pyproject.toml"


def test_tool_versions_match_the_ci_interpreter():
    text = CHECKS_WORKFLOW.read_text(encoding="utf-8")
    pinned = re.search(r'python-version:\s*"(\d+)\.(\d+)"', text)
    assert pinned, "checks.yml must pin an interpreter for the gates to run on"
    major, minor = pinned.groups()
    cfg = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    assert cfg["tool"]["mypy"]["python_version"] == f"{major}.{minor}", (
        "mypy's target must be the interpreter CI installs"
    )
    assert cfg["tool"]["ruff"]["target-version"] == f"py{major}{minor}", (
        "ruff's target must be the interpreter CI installs"
    )
    # and it must clear the floor that makes the numpy stubs parseable at all
    assert (int(major), int(minor)) >= (3, 12), (
        "below 3.12 mypy aborts on numpy's PEP 695 stubs before checking src"
    )


# ---------------------------------------------------------------------------
# check_headers.py anchor leg — the missing-test-anchor gate (REFACTOR_PLAN §5
# Phase 6-B): a claim naming a pytest function must resolve to a `def` under
# tests/ (any file); non-function anchors (gap markers, shots, file paths) are
# not claims. Additions only — every assertion above is untouched.
# Verified by: test_anchor_scan_flags_phantom_claim,
#             test_anchor_scan_accepts_real_claim,
#             test_anchor_scan_ignores_non_function_anchors.
_CHECK_SPEC = importlib.util.spec_from_file_location(
    "check_headers", ROOT / "scripts" / "check_headers.py"
)
CHECK_HEADERS = importlib.util.module_from_spec(_CHECK_SPEC)
_CHECK_SPEC.loader.exec_module(CHECK_HEADERS)


def test_anchor_scan_flags_phantom_claim(tmp_path):
    bad = tmp_path / "phantom_anchor.py"
    # The claim marker is split across string fragments so the tree-wide scan
    # never reads this test's own source line as a phantom claim.
    bad.write_text(
        "# WHAT: synthetic file whose anchor names no test.\n"
        '# Verified' " by: test_i_do_not_exist_987\n",
        encoding="utf-8",
    )
    phantoms = CHECK_HEADERS.find_phantom_anchors([bad])
    assert len(phantoms) == 1, phantoms
    assert "test_i_do_not_exist_987" in phantoms[0]
    assert f"{bad}:2" in phantoms[0]  # reported with its file:line


def test_anchor_scan_accepts_real_claim(tmp_path):
    good = tmp_path / "real_anchor.py"
    good.write_text(
        '"""WHAT: synthetic file with a real cross-file anchor.\n'
        "TESTED BY: tests/test_workflow_yaml.py::test_workflow_exists.\n"
        '"""\n',
        encoding="utf-8",
    )
    # the def lives in ANOTHER file (this one) — cross-file anchors are fine
    assert CHECK_HEADERS.find_phantom_anchors([good]) == []


def test_anchor_scan_ignores_non_function_anchors(tmp_path):
    gaps = tmp_path / "non_function_anchors.py"
    gaps.write_text(
        "# WHAT: synthetic file carrying only non-function anchors.\n"
        "# Verified by: NOTHING (gap — nothing pins this rule).\n"
        "# Verified by: shots/phase3-runtime-gate.json → respondToFilters.\n"
        "# TESTED BY: tests/test_scrape.py and test_foo_module.py (file refs).\n",
        encoding="utf-8",
    )
    # NOTHING (gap), shots/… and test_…py file references are not claims
    assert CHECK_HEADERS.find_phantom_anchors([gaps]) == []
