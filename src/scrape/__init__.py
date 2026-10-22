"""WHAT:      Stage 1 (scrape): Zillow NYC -> raw JSONL per docs/data_contract.md.
WHY:        Package marker; the module map below is the one-hop orientation for
            this stage (each module's own header has the details).
INPUTS:     See each submodule.
OUTPUTS:    The four contract artifacts under ``jobs/<run_id>/raw``.
CALLERS:    ``scripts/run_daily.py`` (via ``python -m src.scrape``).
TESTED BY:  See each submodule; nothing imports this marker directly.

Modules:
- ``config``   - constants only (caps, session default, start URL + seeds)
- ``robots``   - the robots URL gate (is_allowed_url + disallowed prefixes)
- ``proxy``    - DataImpulse credentials, proxy URL, secret scrubbing
- ``http``     - paced single-flight client (curl_cffi, 429/Retry-After, PX abort)
- ``parsing``  - embedded-JSON parsing (search cards, detail property, JSON-LD)
- ``run``      - ScrapeRun orchestration + guards + exit codes
- ``phases``   - search + detail phases (ScrapeRun mixin)
- ``artifacts`` - the 4 contract artifact writers (ScrapeRun mixin)
- ``cli``      - argparse entry point (``python -m src.scrape``)
"""
