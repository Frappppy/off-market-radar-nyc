"""WHAT:      Full-corpus NYC harvester — ZIP-sharded search pass over
           ``/<borough>-ny-<zip>/`` pages (robots-allowed), plus an optional
           detail-enrichment pass, writing the stage-1 contract artifacts.
WHY:        Zillow caps any single search at ~820 results (20 pages) while NYC
           has ~22.7k active listings (the fixture's ``totalResultCount``).
           Sharding by ZIP keeps every slice under the cap; the browser session
           handles the current soft-403/PX behaviour (see ``browser.py``).
INPUTS:     ``config/nyc_zips.csv``, proxy env, optional existing run dir.
OUTPUTS:    ``jobs/<run>/raw/{listings.jsonl,harvest_state.json,
           pages_fetched.json, manifest.json, process_log.md>`` — byte-compatible
           with ``python -m src.clean --in .../raw``.
CALLERS:    CLI (``python -m src.scrape.harvest``), ``scripts/run_full_harvest.py``.
TESTED BY:  ``tests/test_harvest.py`` (shard plan, resume ledger, dedupe,
           fake-session search pass, detail merge).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..common.timeutil import utc_now_iso
from .browser import BrowserSession
from .config import PROJECT_ROOT
from .harvest_state import (
    LISTINGS_FILE, PATCH_FILE, STATE_FILE, HarvestState, append_records,
    apply_patch, load_zips, read_records, rewrite_records, shard_url, write_json,
)
from .parsing import build_record, extract_detail_property, extract_json_ld, parse_search_page
from .proxy import browser_proxy_display, build_browser_proxy, scrub_secrets
from .robots import ROBOTS_SNAPSHOT, is_allowed_url

ZIP_CSV = PROJECT_ROOT / "config" / "nyc_zips.csv"
MIN_DELAY = 2.0
DETAIL_BATCH_SAVE = 250
MAX_ROTATIONS_PER_PAGE = 2


def _abs(url):
    return url if url.startswith("http") else "https://www.zillow.com" + url


def harvest_search(session, out_dir, state, records, zips=None, max_pages=20,
                   max_shards=None, log=print):
    """Follow every pending shard to pagination exhaustion. Returns audit rows."""
    audit = []
    shards = [s for s in state.pending() if not zips or s["zip"] in zips]
    if max_shards:
        shards = shards[:max_shards]
    for index, shard in enumerate(shards, start=1):
        zip_code = shard["zip"]
        url = shard.get("next_url") or shard_url(shard["borough"], zip_code)
        pages = shard.get("pages") or 0
        new_rows = 0
        total = shard.get("total")
        status, error = "done", None
        log(f"[{index}/{len(shards)}] {zip_code} {shard['borough']} start "
            f"(page {pages + 1}) url={url}")
        while pages < max_pages:
            if not is_allowed_url(url):
                status, error = "failed", f"robots refused {url}"
                break
            page = session.fetch(url, expect="search")
            audit.extend(page.audit)
            rotations = 0
            while page.blocked and rotations < MAX_ROTATIONS_PER_PAGE:
                rotations += 1
                number = session.rotate()
                if number is None:
                    break
                log(f"    hard block -> rotated to exit #{number}, retrying")
                page = session.fetch(url, expect="search")
                audit.extend(page.audit)
            if page.error:
                status, error = "failed", scrub_secrets(page.error)
                break
            try:
                parsed = parse_search_page(page.html)
            except ValueError as exc:
                status, error = "failed", f"unparseable search page: {exc}"
                break
            pages += 1
            if parsed.total_result_count:
                total = parsed.total_result_count
            fresh = []
            for card in parsed.listings:
                record = build_record(card, None, None, None,
                                      scraped_at=utc_now_iso())
                if record is None or record["listing_id"] in records:
                    continue
                records[record["listing_id"]] = record
                fresh.append(record)
            if fresh:
                append_records(Path(out_dir) / LISTINGS_FILE, fresh)
                new_rows += len(fresh)
            nxt = _abs(parsed.next_url) if parsed.next_url else None
            state.mark(zip_code, pages=pages, total=total,
                       listings=shard["listings"] + len(fresh),
                       next_url=nxt, last_error=None)
            log(f"    page {pages}: {len(parsed.listings)} cards, "
                f"+{len(fresh)} new (total seen {len(records)}"
                + (f", zip reports {total}" if total else "") + ")")
            if not nxt or not is_allowed_url(nxt):
                if nxt:
                    log(f"    robots refused next link {nxt} — shard stops here")
                break
            url = nxt
        if pages >= max_pages and status == "done" and shard.get("next_url"):
            # Cap hit mid-shard: keep it resumable (next run continues from
            # the stored next_url) instead of pretending the ZIP is complete.
            status = "pending"
            error = f"page cap {max_pages} reached (zip reports {total})"
        state.mark(zip_code, status=status, last_error=error)
        if error:
            log(f"    shard {zip_code}: {status} — {error}")
    return audit


def _merge_detail(record, prop, html, json_ld):
    """Detail fields merged onto the search-card row, keyed by the card's id.

    Refuses the merge when the detail page reports a different listing: the
    id is the ledger key, and relabelling listing B's fields as listing A
    would corrupt A without a trace (same rule as
    ``phases._run_detail_phase``; verified by test_detail_of_other_listing_is_refused).
    """
    merged = build_record(None, prop, html, json_ld, scraped_at=utc_now_iso())
    if merged is None:
        return None
    if merged["listing_id"] != record["listing_id"]:
        return None
    for key in ("url", "city", "state", "zip", "price_previous",
                "price_reduced", "days_on_market", "property_type"):
        if merged.get(key) in (None, False) and record.get(key) not in (None, False):
            merged[key] = record[key]
    return merged


def harvest_details(session, out_dir, records, mode="motivated", limit=None,
                    log=print):
    """Enrich selected rows from ``/homedetails/`` pages; atomic rewrites."""
    done_path = Path(out_dir) / "details_done.txt"
    done = set(done_path.read_text(encoding="utf-8").split()) if done_path.exists() else set()
    if mode == "motivated":
        targets = [r for r in records.values()
                   if r.get("price_reduced") or (r.get("days_on_market") or 0) > 60]
    else:
        targets = list(records.values())
    targets.sort(key=lambda r: (not r.get("price_reduced"),
                                -(r.get("days_on_market") or 0)))
    targets = [r for r in targets if r["listing_id"] not in done]
    if limit:
        targets = targets[:limit]
    log(f"details: {len(targets)} target(s), mode={mode} "
        f"({len(done)} already enriched)")
    audit, enriched = [], 0
    with done_path.open("a", encoding="utf-8") as done_handle:
        for index, record in enumerate(targets, start=1):
            if not is_allowed_url(record["url"]):
                continue
            page = session.fetch(record["url"], expect="detail")
            audit.extend(page.audit)
            rotations = 0
            while page.blocked and rotations < MAX_ROTATIONS_PER_PAGE:
                rotations += 1
                number = session.rotate()
                if number is None:
                    break
                log(f"    hard block -> rotated to exit #{number}, retrying listing")
                page = session.fetch(record["url"], expect="detail")
                audit.extend(page.audit)
            if page.error:
                log(f"    {index}/{len(targets)} {record['listing_id']} — {page.error}")
                continue
            merged = _merge_detail(record, extract_detail_property(page.html),
                                   page.html, extract_json_ld(page.html))
            if merged is None:
                log(f"    {index}/{len(targets)} {record['listing_id']} — "
                    "no detail record (unparseable, or the page is another listing)")
                continue
            records[record["listing_id"]] = merged
            enriched += 1
            append_records(Path(out_dir) / PATCH_FILE, [merged])
            done_handle.write(record["listing_id"] + "\n")
            done_handle.flush()
            if enriched % DETAIL_BATCH_SAVE == 0:
                rewrite_records(Path(out_dir) / LISTINGS_FILE, records.values())
                log(f"    {index}/{len(targets)} — {enriched} enriched, saved")
    if enriched:
        rewrite_records(Path(out_dir) / LISTINGS_FILE, records.values())
    return audit, enriched


def run(out_dir, zips=None, max_pages=20, max_shards=None, delay=2.5,
        details="none", details_limit=None, proxy_session=None, headless=False,
        solve_timeout=900, profile_dir=None):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    shard_rows = load_zips(ZIP_CSV)
    if zips:
        wanted = {z.strip() for z in zips}
        shard_rows = [(z, b) for z, b in shard_rows if z in wanted]
    if not shard_rows:
        print("no ZIP shards selected", file=sys.stderr)
        return 2
    state = HarvestState.load(out / STATE_FILE, shard_rows)
    records = read_records(out / LISTINGS_FILE)
    patched = apply_patch(records, out / PATCH_FILE)
    if patched:
        print(f"resume: applied {patched} enriched row(s) from {PATCH_FILE}", flush=True)
    started = utc_now_iso()
    proxy = build_browser_proxy(proxy_session)
    proxy_label = browser_proxy_display(proxy_session) if proxy else "direct (no credentials)"
    profile = profile_dir or str(
        Path.home() / ".local" / "state" / "off-market-radar" / "browser-profile")
    print(f"harvest: {len(shard_rows)} shard(s), {len(records)} rows already on disk, "
          f"proxy={proxy_label}, "
          f"delay={max(MIN_DELAY, delay):g}s", flush=True)
    if proxy is None:
        print("WARNING: no usable DataImpulse credentials — this run uses the "
              "machine's own IP and will be challenged often. Fill "
              "config/dataimpulse.local.env before a full-city run.", flush=True)
    audit = []
    seed = proxy_session or "nyc"

    def proxy_factory(number):
        return build_browser_proxy(f"{seed}-r{number}")

    try:
        with BrowserSession(profile, proxy=proxy, headless=headless,
                            min_delay=max(MIN_DELAY, delay),
                            solve_timeout=solve_timeout,
                            proxy_factory=proxy_factory) as session:
            audit += harvest_search(session, out, state, records, zips=zips,
                                    max_pages=max_pages, max_shards=max_shards)
            enriched = 0
            if details != "none":
                detail_audit, enriched = harvest_details(
                    session, out, records, mode=details, limit=details_limit)
                audit += detail_audit
    except KeyboardInterrupt:
        print("\ninterrupted — state saved, rerun the same command to resume", flush=True)
        rewrite_records(out / LISTINGS_FILE, records.values())
        _finalize(out, state, records, started, audit, "partial", "interrupted",
                  proxy_label)
        return 130
    counts = state.counts()
    status = "success" if counts["failed"] == 0 else "partial"
    _finalize(out, state, records, started, audit, status,
              f"{counts['failed']} shard(s) failed" if counts["failed"] else None,
              proxy_label)
    print(f"done: {len(records)} unique listings -> {out / LISTINGS_FILE}; "
          f"shards done {counts['done']}/{counts['total']}", flush=True)
    return 0 if status == "success" else 1


def _finalize(out, state, records, started, audit, status, reason, proxy_label):
    totals = [s["total"] for s in state.data["shards"].values() if s.get("total")]
    write_json(out / "pages_fetched.json", audit)
    write_json(out / "manifest.json", {
        "stage": "scrape",
        "run_id": out.parent.name,
        "records_in": sum(s.get("listings") or 0
                          for s in state.data["shards"].values()),
        "records_out": len(records),
        "started_at": started,
        "finished_at": utc_now_iso(),
        "status": status,
        "reason": reason,
        "shards": state.counts(),
        "reported_results_sum": sum(totals) if totals else None,
    })
    lines = [
        "# process log — full-corpus harvest (browser, ZIP-sharded)", "",
        f"- started_at: {started}", f"- finished_at: {utc_now_iso()}",
        f"- status: {status}" + (f" ({reason})" if reason else ""),
        f"- unique listings: {len(records)}",
        f"- reported result count (sum of ZIP totals): {sum(totals) if totals else 'n/a'}",
        f"- requests: {len(audit)}",
        "- pacing: >= 2.0s between navigations, single flight, headed Chromium",
        f"- proxy: {proxy_label} (credentials from `config/dataimpulse.local.env`, never logged)",
        f"- robots: `{ROBOTS_SNAPSHOT}` — only `/<slug>/` and `/<slug>/N_p/`",
        "- CAPTCHA: run pauses, human solves in the browser, same cookies continue",
        "", "## Shards", "| zip | borough | status | pages | listings | total |",
        "|---|---|---|---|---|---|",
    ]
    for shard in state.data["shards"].values():
        lines.append(f"| {shard['zip']} | {shard['borough']} | {shard['status']} | "
                     f"{shard['pages']} | {shard['listings']} | {shard['total']} |")
    (out / "process_log.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m src.scrape.harvest")
    parser.add_argument("--out", required=True, help="jobs/<run_id>/raw")
    parser.add_argument("--zips", help="comma-separated ZIP subset (default: all NYC)")
    parser.add_argument("--max-pages", type=int, default=20, help="pages per ZIP")
    parser.add_argument("--max-shards", type=int, help="stop after N shards (smoke test)")
    parser.add_argument("--delay", type=float, default=2.5)
    parser.add_argument("--details", choices=("none", "motivated", "all"),
                        default="none")
    parser.add_argument("--details-limit", type=int)
    parser.add_argument("--session", help="sticky proxy session name")
    parser.add_argument("--profile", help="Chromium profile dir (cookies/resume identity)")
    parser.add_argument("--solve-timeout", type=int, default=300,
                        help="seconds to wait for a manual CAPTCHA solve before "
                             "rotating the proxy exit")
    parser.add_argument("--headless", action="store_true",
                        help="not recommended: a CAPTCHA cannot be solved unseen")
    args = parser.parse_args(argv)
    zips = {z.strip() for z in args.zips.split(",")} if args.zips else None
    return run(args.out, zips=zips, max_pages=args.max_pages,
               max_shards=args.max_shards, delay=args.delay,
               details=args.details, details_limit=args.details_limit,
               proxy_session=args.session, headless=args.headless,
               solve_timeout=args.solve_timeout, profile_dir=args.profile)


if __name__ == "__main__":
    raise SystemExit(main())
