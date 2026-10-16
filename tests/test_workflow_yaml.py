"""Validate .github/workflows/daily_pipeline.yml: only the six allowed secrets,
no leaked values, cron present, pipeline invoked."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# This project folder is the repository root, so the workflow must live in its
# own .github/workflows/ (GitHub Actions only reads workflows from the root).
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
