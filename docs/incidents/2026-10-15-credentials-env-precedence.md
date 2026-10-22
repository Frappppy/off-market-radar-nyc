# 2026-10-15 — stale machine-level `DATAIMPULSE_*` env vars shadowed the credential file (every proxy CONNECT → `407 NO_USER`)

**Stage:** 1 (scrape) · **Symptom:** every proxy CONNECT failed with
`407 NO_USER` even though the credentials in the gitignored project file were
valid. **Code affected:** `src/scrape/config.py` →
`load_dataimpulse_credentials()` (today: `src/scrape/proxy.py`).

## Narrative (moved verbatim from the old `load_dataimpulse_credentials` docstring)

> Precedence matters: on 2026-10-15 stale machine-level
> `DATAIMPULSE_LOGIN`/`DATAIMPULSE_PASSWORD` env vars shadowed the file and
> every proxy CONNECT failed with `407 NO_USER`, while the file's credentials
> authenticated fine (`200 OK`).

## Resolution

The gitignored project file (`config/dataimpulse.local.env`) is
**authoritative when present**; OS environment variables fill only the keys
the file does not provide. Never let process-level env shadow the file.

## Where the code lives now

`load_dataimpulse_credentials()` — `src/scrape/proxy.py`.
