"""WHAT:      .github/workflows/daily_pipeline.yml guards — the file exists at
           the repo root, references exactly the six allowed GitHub secrets
           (no leaked connection strings or values), keeps its cron and
           workflow_dispatch triggers, and invokes scripts/run_daily.py with
           the venv interpreter.
WHY:       The workflow holds the only production credentials in the repo; a
           leak or a silently edited stage would go unnoticed until the next
           10:00 UTC run. Parsed as text — no Actions runner needed.
INPUTS:    .github/workflows/daily_pipeline.yml (raw text only).
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — suite baseline: 155 passed, 2 skipped.
"""

import importlib.util
import re
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
