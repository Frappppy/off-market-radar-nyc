"""WHAT:      Offline tests for the full-corpus harvester — ZIP shard plan,
           resumable ledger, crash-safe JSONL, payload-based block detection,
           the fake-session search pass and the detail merge.
WHY:        The live run is long and network-bound; everything that decides
           *what* gets written must be pinned offline (no browser, no proxy).
INPUTS:    tests/fixtures/zillow_pages.py + src.scrape.harvest*.
OUTPUTS:   pytest verdicts only (tmp_path files).
CALLERS:   `python -m pytest`.
"""

import json

import pytest

from src.scrape.browser import FetchPage, page_payload_kind
from src.scrape.harvest import _merge_detail, harvest_search
from src.scrape.harvest_state import (
    HarvestState, append_records, apply_patch, load_zips, read_records, rewrite_records,
    shard_url,
)
from src.scrape.robots import is_allowed_url
from tests.fixtures.zillow_pages import (
    DETAIL_PROPERTY, SEARCH_CARD, SEARCH_PAGE, detail_html, search_html,
)


# --- shard plan + robots -----------------------------------------------------


def test_shard_urls_use_borough_slug_and_pass_robots():
    assert shard_url("brooklyn", "11215") == "https://www.zillow.com/brooklyn-ny-11215/"
    assert is_allowed_url(shard_url("queens", "11354"))
    # Zillow's own canonical pagination (seen live 2026-10-23)
    assert is_allowed_url("https://www.zillow.com/queens-new-york-ny-11354/2_p/")
    assert not is_allowed_url(
        "https://www.zillow.com/queens-ny-11354/?searchQueryState=%7B%7D")


def test_load_zips_reads_csv(tmp_path):
    path = tmp_path / "z.csv"
    path.write_text("zip,borough\n11215,brooklyn\n11354,queens\n")
    assert load_zips(path) == [("11215", "brooklyn"), ("11354", "queens")]


# --- ledger + crash safety ---------------------------------------------------


def test_state_roundtrip_and_merge(tmp_path):
    path = tmp_path / "state.json"
    state = HarvestState.load(path, [("11215", "brooklyn")])
    state.mark("11215", status="done", pages=5, total=165)
    again = HarvestState.load(path, [("11215", "brooklyn"), ("11354", "queens")])
    assert again.shard("11215")["status"] == "done"
    assert again.shard("11215")["total"] == 165
    assert again.shard("11354")["status"] == "pending"  # newly added shard
    assert again.counts()["done"] == 1


def test_torn_jsonl_line_is_ignored_and_dupes_collapse(tmp_path):
    path = tmp_path / "listings.jsonl"
    append_records(path, [{"listing_id": "1"}, {"listing_id": "2"}])
    with path.open("a") as handle:
        handle.write('{"listing_id": "3"')  # hard kill mid-write
    with path.open("a") as handle:
        handle.write("\n" + json.dumps({"listing_id": "1", "price_current": 9}) + "\n")
    records = read_records(path)
    assert set(records) == {"1", "2"}
    assert records["1"]["price_current"] == 9  # last write wins


def test_rewrite_is_atomic_and_keeps_order(tmp_path):
    path = tmp_path / "listings.jsonl"
    rewrite_records(path, [{"listing_id": "a"}, {"listing_id": "b"}])
    assert [r["listing_id"] for r in read_records(path).values()] == ["a", "b"]
    assert not (tmp_path / "listings.jsonl.tmp").exists()


def test_detail_patch_overlays_and_survives_a_kill(tmp_path):
    path = tmp_path / "details_patch.jsonl"
    append_records(path, [{"listing_id": "1", "price_current": 10,
                           "price_history": [{"price": 10}]}])
    with path.open("a") as handle:
        handle.write('{"listing_id": "2"')  # hard kill mid-write
    records = {"1": {"listing_id": "1", "price_current": 1},
               "3": {"listing_id": "3"}}
    assert apply_patch(records, path) == 1
    assert records["1"]["price_current"] == 10
    assert set(records) == {"1", "3"}


# --- payload detection (the soft-403 rule) ----------------------------------


def test_payload_detection_search_and_detail():
    assert page_payload_kind(search_html(), expect="search") == "search"
    assert page_payload_kind(detail_html(), expect="detail") == "detail"
    assert page_payload_kind(search_html(), expect="detail") is None
    assert page_payload_kind("<html>denied</html>", expect="search") is None


# --- search pass with a fake session ----------------------------------------


class FakeSession:
    """Two ZIP pages: page 1 has 2 cards, page 2 repeats one and adds another."""

    def __init__(self):
        card_a = dict(SEARCH_CARD, zpid="111", detailUrl=SEARCH_CARD["detailUrl"])
        card_b = dict(SEARCH_CARD, zpid="222")
        card_c = dict(SEARCH_CARD, zpid="333")
        self.pages = {
            "https://www.zillow.com/brooklyn-ny-11215/":
                self._html([card_a, card_b], "/brooklyn-new-york-ny-11215/2_p/"),
            "https://www.zillow.com/brooklyn-new-york-ny-11215/2_p/":
                self._html([card_b, card_c], None),
        }
        self.calls = []

    @staticmethod
    def _html(cards, next_url):
        payload = json.loads(json.dumps(SEARCH_PAGE))
        cat1 = payload["props"]["pageProps"]["searchPageState"]["cat1"]
        cat1["searchResults"]["listResults"] = cards
        cat1["searchList"]["pagination"]["nextUrl"] = next_url
        cat1["searchList"]["totalResultCount"] = 3
        return search_html(payload)

    def fetch(self, url, expect=None, **_kwargs):
        self.calls.append(url)
        html = self.pages[url]
        return FetchPage(url=url, status=403, final_url=url, html=html,
                         fetched_at="2026-10-23T00:00:00Z",
                         audit=[{"url": url, "status": 403}])


def test_search_pass_paginates_dedupes_and_marks_done(tmp_path):
    out = tmp_path / "raw"
    out.mkdir()
    state = HarvestState.load(out / "harvest_state.json", [("11215", "brooklyn")])
    records = {}
    session = FakeSession()
    audit = harvest_search(session, out, state, records, log=lambda *_: None)
    assert len(session.calls) == 2
    assert set(records) == {"111", "222", "333"}
    assert state.shard("11215")["status"] == "done"
    assert state.shard("11215")["pages"] == 2
    assert len(audit) == 2
    assert len(read_records(out / "listings.jsonl")) == 3
    # rerun skips the finished shard entirely
    harvest_search(session, out, state, records, log=lambda *_: None)
    assert len(session.calls) == 2


def test_blocked_page_rotates_proxy_and_retries(tmp_path):
    class Blocking(FakeSession):
        def __init__(self):
            super().__init__()
            self.rotations = 0

        def fetch(self, url, expect=None, **kwargs):
            if self.rotations == 0:
                return FetchPage(url=url, status=403, final_url=url, html="",
                                 fetched_at="x", error="hard block", blocked=True)
            return super().fetch(url, expect=expect)

        def rotate(self):
            self.rotations += 1
            return self.rotations

    out = tmp_path / "raw"
    out.mkdir()
    state = HarvestState.load(out / "harvest_state.json", [("11215", "brooklyn")])
    records = {}
    session = Blocking()
    harvest_search(session, out, state, records, log=lambda *_: None)
    assert session.rotations == 1
    assert set(records) == {"111", "222", "333"}
    assert state.shard("11215")["status"] == "done"


def test_failed_page_marks_shard_and_keeps_earlier_rows(tmp_path):
    class Broken(FakeSession):
        def fetch(self, url, expect=None, **_kwargs):
            if url.endswith("/2_p/"):
                return FetchPage(url=url, status=200, final_url=url, html="<html/>",
                                 fetched_at="x", error="no search payload")
            return super().fetch(url, expect=expect)

    out = tmp_path / "raw"
    out.mkdir()
    state = HarvestState.load(out / "harvest_state.json", [("11215", "brooklyn")])
    records = {}
    harvest_search(Broken(), out, state, records, log=lambda *_: None)
    assert state.shard("11215")["status"] == "failed"
    assert set(records) == {"111", "222"}  # page 1 rows survive


# --- detail merge ------------------------------------------------------------


def test_merge_detail_keeps_search_signals():
    old = {"listing_id": "123456", "url": "https://www.zillow.com/homedetails/x/123456_zpid/",
           "price_previous": 500000, "price_reduced": True, "days_on_market": 120,
           "city": "Brooklyn", "state": "NY", "zip": "11201",
           "property_type": "house", "price_current": 475000}
    merged = _merge_detail(old, DETAIL_PROPERTY, detail_html(), None)
    assert merged["listing_id"] == "123456"
    assert merged["price_current"] == 475000
    assert merged["price_reduced"] is True
    # detail embedded JSON wins over the search card when both have the field
    assert merged["days_on_market"] == 112
