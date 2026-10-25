"""WHAT:      The fetched robots snapshot as the authority over the hardcoded
           URL-shape allow list — deny rules, the missing-file floor, the
           wildcard/anchor translation, and the shared redirect guard.
WHY:       Invariant I10: `docs/robots_precheck.md` recorded that Zillow's
           robots.txt denies paths this pipeline's shape list happily allows
           (/discovery/, /trk/, /ui/, …). The snapshot layer is what closes
           that gap, and `redirect_refusal` is the stricter-on-robots,
           looser-on-query-strings guard the two gates share
           (docs/decisions.md §2). Split out of tests/test_scrape.py on
           2026-10-25 when the parent passed the 300-line hard cap (§7).
INPUTS:    src.scrape.robots only — pure functions over the committed snapshot;
           no network, no credentials, no fixtures.
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — the current suite count lives in tests/README.md.
Verified by: test_snapshot_denies_paths_the_shape_allows,
           test_snapshot_allows_the_shipped_url_shapes,
           test_snapshot_rules_survive_a_missing_file,
           test_rule_to_regex_honours_wildcard_and_anchor, test_redirect_refusal.
"""

import pytest

from src.scrape import robots


# --- the snapshot denies what the shape list alone would let through ----------

@pytest.mark.parametrize(
    "path",
    ["/discovery/", "/trk/", "/ui/", "/pricing/", "/videodetails/", "/m/",
     "/learnmore/", "/widgets/"],
)
def test_snapshot_denies_paths_the_shape_allows(path):
    """Each of these matches SEARCH_PATH_RE — the shape list alone let them
    through, and every one is an explicit `Disallow` in the fetched snapshot."""
    assert robots.SEARCH_PATH_RE.match(path), "shape list accepts it"
    assert robots.snapshot_denies(path), "the snapshot denies it"
    assert robots.is_allowed_url(f"https://www.zillow.com{path}") is False


@pytest.mark.parametrize(
    "path",
    ["/new-york-ny/", "/brooklyn-ny/", "/new-york-ny/2_p/", "/astoria-ny/3_p/",
     "/homedetails/31496560/", "/homedetails/56-E-1st-St/New_York-NY/"],
)
def test_snapshot_allows_the_shipped_url_shapes(path):
    """The URLs this pipeline actually requests must survive the new layer:
    a deny list that emptied the allow list would be its own outage."""
    assert robots.is_allowed_url(f"https://www.zillow.com{path}") is True


def test_snapshot_rules_survive_a_missing_file():
    """No snapshot => no deny rules, and the hardcoded prefix floor still
    refuses /api/ — never a silent widening of access."""
    assert robots._snapshot_rules(path="/nonexistent/robots.txt") == ()
    assert robots.snapshot_denies("/trk/", rules=()) is False
    assert robots.is_allowed_url("https://www.zillow.com/api/x") is False


def test_rule_to_regex_honours_wildcard_and_anchor():
    assert robots._rule_to_regex("/homes/for_sale/$").match("/homes/for_sale/")
    assert not robots._rule_to_regex("/homes/for_sale/$").match("/homes/for_sale/2_p/")
    assert robots._rule_to_regex("/*_rect").match("/a/b_rect")
    assert robots._rule_to_regex("/m").match("/map")  # unanchored = prefix


def test_redirect_refusal():
    """The shared redirect guard: looser than the strict gate on query strings
    (legal Zillow redirects), stricter on the snapshot (docs/decisions.md §2)."""
    base = "https://www.zillow.com/new-york-ny/"
    assert robots.redirect_refusal(base, base) is None
    assert robots.redirect_refusal(base, base + "extra/") is None
    assert robots.redirect_refusal(base, base + "?sort=pricea") is None
    assert "off zillow.com" in robots.redirect_refusal(base, "https://evil.example/a/")
    assert "disallowed" in robots.redirect_refusal(base, "https://www.zillow.com/api/x")
    assert "snapshot" in robots.redirect_refusal(base, "https://www.zillow.com/trk/")
