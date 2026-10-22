"""WHAT:      DataImpulse proxy plumbing for stage 1 — credential loading,
           proxy URL construction, display formatting and secret scrubbing.
WHY:        Secret handling must live in exactly one reviewable module; the
           file/env precedence rule here is security-relevant (the incident
           behind it: docs/incidents/2026-10-15-credentials-env-precedence.md).
INPUTS:     ``config/dataimpulse.local.env`` (gitignored, authoritative when
            present) + ``DATAIMPULSE_*`` OS environment variables.
OUTPUTS:    ``build_proxy_url()`` (or ``None`` without credentials),
            ``proxy_display()`` (never contains credentials), ``scrub_secrets()``.
CALLERS:    ``src.scrape.http`` (scrub), ``src.scrape.run`` (build),
            ``src.scrape.artifacts`` (display), ``tests/test_scrape.py``.
TESTED BY:  ``tests/test_scrape.py`` — ``test_proxy_url_uses_mandatory_geo*``
            and ``test_scrub_secrets_masks_credentials`` (both in that file).
            (skip without credentials).
"""

import os

from .config import PROJECT_ROOT

LOCAL_ENV = PROJECT_ROOT / "config" / "dataimpulse.local.env"

_credentials_cache = None


def load_dataimpulse_credentials():
    """Credentials for the DataImpulse proxy.

    The gitignored project file (``config/dataimpulse.local.env``) is
    **authoritative when present**; OS environment variables fill only the
    keys the file does not provide. Precedence matters: stale machine-level
    ``DATAIMPULSE_LOGIN``/``DATAIMPULSE_PASSWORD`` env vars shadowing the file
    used to fail every proxy CONNECT (see the incident doc above).
    Verified by: NOTHING (gap — the two proxy tests skip without real
    credentials on the machine; see REPO_MAP §10).
    """
    global _credentials_cache
    if _credentials_cache is not None:
        return dict(_credentials_cache)
    creds = {}
    if LOCAL_ENV.exists():
        for line in LOCAL_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key.startswith("DATAIMPULSE_") and value.strip():
                creds[key] = value.strip()
    for key in ("DATAIMPULSE_LOGIN", "DATAIMPULSE_PASSWORD", "DATAIMPULSE_HOST", "DATAIMPULSE_PORT"):
        value = os.environ.get(key)
        if value and value.strip() and key not in creds:
            creds[key] = value.strip()
    _credentials_cache = dict(creds)
    return dict(creds)


def build_proxy_url(sessid=None):
    creds = load_dataimpulse_credentials()
    login = creds.get("DATAIMPULSE_LOGIN")
    password = creds.get("DATAIMPULSE_PASSWORD")
    if not login or not password:
        return None
    host = creds.get("DATAIMPULSE_HOST") or "gw.dataimpulse.com"
    port = creds.get("DATAIMPULSE_PORT") or "823"
    user = f"{login}__cr.us"
    if sessid:
        user = f"{user};sessid.{sessid}"
    return f"http://{user}:{password}@{host}:{port}"


def proxy_display(sessid=None):
    creds = load_dataimpulse_credentials()
    host = creds.get("DATAIMPULSE_HOST") or "gw.dataimpulse.com"
    port = creds.get("DATAIMPULSE_PORT") or "823"
    mode = f"sessid={sessid}" if sessid else "rotating"
    return f"{host}:{port} (cr.us, {mode})"


def scrub_secrets(text):
    if not text:
        return text
    creds = load_dataimpulse_credentials()
    for key in ("DATAIMPULSE_PASSWORD", "DATAIMPULSE_LOGIN"):
        value = creds.get(key)
        if value:
            text = text.replace(value, "***")
    return text
