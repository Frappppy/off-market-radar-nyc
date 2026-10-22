# dashboard/ — Stage 4 (Power BI, offline consumer of the same views)

**What lives here.**

- `views.sql` — the **three** views both consumers read: `vw_latest_listings`,
  `vw_zip_price_drop_30d` (Power BI + site) and `vw_listing_history` (site's
  price-history panel). Apply once, manually.
- `dax_measures.dax` — the 6 measures pasted into Power BI.
- `build_guide.md` — click-by-click build (Steps 0–10).
- `verify_contract.py` — manual sqlglot gate: views ↔ contract DDL ↔ DAX ↔
  build guide, **54 checks**, exit 0/1. Run: `python dashboard/verify_contract.py`.

**The one trap.** `build_guide.md` describes the **two** views Power BI loads
and still says "two views" in places; `views.sql` now creates **three** —
`vw_listing_history` was added later for the site and is deliberately not part
of the Power BI model. (Flagged as REPO_MAP §9 drift; the guide is a historical
runbook and was left as written.) Also: `verify_contract.py` is **not in CI** —
run it by hand after touching any of the four files.

**Detail.** `build_guide.md` Step 10 lists the GUI-only steps that can't be
verified headlessly.
