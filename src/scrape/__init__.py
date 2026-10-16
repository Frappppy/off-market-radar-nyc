"""Stage 1 (scrape): Zillow NYC -> raw JSONL per docs/data_contract.md.

Modules:
- ``config``   - proxy credentials (gitignored env), robots URL gate, caps
- ``http``     - paced single-flight client (curl_cffi, 429/Retry-After, PX abort)
- ``parsers``  - embedded-JSON parsing (search cards, detail property, JSON-LD)
- ``pipeline`` - run orchestration + contract artifacts
- ``cli``      - argparse entry point (``python -m src.scrape``)
"""
