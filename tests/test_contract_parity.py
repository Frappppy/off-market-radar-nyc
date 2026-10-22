"""WHAT:      Contract-vs-code parity guards — I13 (docs/data_contract.md DDL vs
           sql/schema.sql: same columns, same order, per table), I12
           (mapping.LISTING_COLUMNS / SNAPSHOT_COLUMNS vs the schema the loader
           writes), I2 (contract Stage 1/2 field lists vs clean's
           RAW_COLUMNS / DERIVED_COLUMNS).
WHY:       The contract is hand-maintained while the pipeline executes its own
           copies of every name; nothing else links the two, so drift would
           break production loads silently. All comparison logic lives in the
           pure helpers below; the negative tests feed them MUTATED SYNTHETIC
           input to prove each check fires on drift — no repo file is mutated.
INPUTS:    docs/data_contract.md, sql/schema.sql, src.clean/frame.py,
           src/store/mapping.py.
OUTPUTS:   pytest verdicts only.
CALLERS:   `python -m pytest` — suite baseline: 155 passed, 2 skipped.
"""

import re

import sqlglot

from src.clean.derive import DERIVED_COLUMNS
from src.clean.frame import RAW_COLUMNS
from src.store import mapping
# ROOT/SCHEMA path constants reused from the existing schema test, not redefined.
from tests.test_schema_sqlglot import ROOT, SCHEMA

CONTRACT = ROOT / "docs" / "data_contract.md"
TABLES = ("listings", "listing_snapshots", "pipeline_runs")


# --- pure comparison helpers (each exercised by a negative test below) -------

def extract_ddl_tables(sql_text: str) -> dict[str, list[str]]:
    """Parse Postgres DDL into {table_name: [column names in declaration order]}."""
    tables: dict[str, list[str]] = {}
    for stmt in sqlglot.parse(sql_text, dialect="postgres"):
        if stmt is None or stmt.key != "create":
            continue  # ALTER / CREATE INDEX / unparsable -> not a table definition
        kind = stmt.args.get("kind")
        if kind is not None and str(getattr(kind, "this", kind)).upper() != "TABLE":
            continue  # CREATE VIEW etc.
        schema = stmt.this
        if not isinstance(schema, sqlglot.exp.Schema):
            continue
        tables[schema.this.name] = [
            col.name
            for col in schema.expressions
            if isinstance(col, sqlglot.exp.ColumnDef)  # skips PRIMARY KEY/UNIQUE/FK clauses
        ]
    return tables


def table_columns(ddl_tables: dict[str, list[str]], name: str) -> list[str]:
    """Columns of one table; fails loudly listing the tables that DO exist."""
    if name not in ddl_tables:
        raise AssertionError(f"table {name!r} not found in DDL (found: {sorted(ddl_tables)})")
    return ddl_tables[name]


def diff(expected, actual) -> str:
    """'' when both column lists match exactly (order included), else a report."""
    expected, actual = list(expected), list(actual)
    if expected == actual:
        return ""
    bits = []
    missing = [c for c in expected if c not in actual]
    unexpected = [c for c in actual if c not in expected]
    if missing:
        bits.append(f"missing {missing}")
    if unexpected:
        bits.append(f"unexpected {unexpected}")
    if not bits:
        bits.append(f"same columns, wrong order: expected {expected}, got {actual}")
    return "; ".join(bits)


def _between(md: str, start: str, end: str) -> str:
    """Text between two markdown headings; fails loudly if either was renamed."""
    for marker in (start, end):
        assert marker in md, f"contract heading {marker!r} not found (renamed?)"
    return md.split(start, 1)[1].split(end, 1)[0]


def contract_stage3_ddl(md: str) -> str:
    """The first ```sql block after '## Stage 3' — the hand-copied DDL."""
    match = re.search(r"```sql\s*\n(.*?)```", _between(md, "## Stage 3", "## Pacing"), re.DOTALL)
    assert match, "no ```sql block under '## Stage 3' in the contract"
    return match.group(1)


def _table_field_names(section: str) -> list[str]:
    """First column of every markdown-table row, skipping the header/separator."""
    names, in_body = [], False
    for line in (line.strip() for line in section.splitlines()):
        if not in_body:
            in_body = bool(re.fullmatch(r"\|[\s:|-]+\|", line))  # |---|---|---|
            continue
        match = re.match(r"\|\s*([a-z_][a-z_0-9]*)\s*\|", line)
        if match:
            names.append(match.group(1))
    return names


def contract_stage1_fields(md: str) -> list[str]:
    """Field names from the Stage 1 raw-JSONL table (extracted, not hardcoded)."""
    return _table_field_names(_between(md, "## Stage 1", "## Stage 2"))


def contract_stage2_derived(md: str) -> list[str]:
    """Derived field names from the Stage 2 'plus' bullet list."""
    section = _between(md, "## Stage 2", "## Stage 3").split("**Motivation rules", 1)[0]
    return re.findall(r"^- `([a-z_][a-z_0-9]*)`", section, re.MULTILINE)


# --- positive: the real files agree today -----------------------------------

def test_contract_stage3_ddl_matches_schema_sql():
    """I13: contract's hand-copied DDL vs sql/schema.sql — same columns, same order, per table."""
    contract = extract_ddl_tables(contract_stage3_ddl(CONTRACT.read_text(encoding="utf-8")))
    schema = extract_ddl_tables(SCHEMA.read_text(encoding="utf-8"))
    for table in TABLES:
        report = diff(table_columns(contract, table), table_columns(schema, table))
        assert report == "", f"I13 drift in {table} (contract vs sql/schema.sql): {report}"


def test_mapping_listing_columns_match_schema():
    """I12: LISTING_COLUMNS must be the schema's listings columns minus managed ones, in order."""
    schema_cols = table_columns(extract_ddl_tables(SCHEMA.read_text(encoding="utf-8")), "listings")
    # Intentionally NOT in the loader's INSERT (which store/statements.py
    # builds from LISTING_COLUMNS): first_seen_at/last_seen_at are DEFAULT now() bookkeeping
    # refreshed only via ON CONFLICT / read by _MARK_STALE; is_active is DEFAULT
    # true, flipped by ON CONFLICT (is_active = true) and mark_stale_listings.
    managed = {"first_seen_at", "last_seen_at", "is_active"}
    assert set(schema_cols) - set(mapping.LISTING_COLUMNS) == managed
    assert tuple(c for c in schema_cols if c not in managed) == mapping.LISTING_COLUMNS
    assert len(mapping.LISTING_COLUMNS) == 13


def test_mapping_snapshot_columns_match_schema():
    """I12: SNAPSHOT_COLUMNS must be the schema's listing_snapshots columns minus managed ones, in order."""
    schema_cols = table_columns(
        extract_ddl_tables(SCHEMA.read_text(encoding="utf-8")), "listing_snapshots"
    )
    # snapshot_id is the bigserial surrogate PRIMARY KEY: generated by Postgres
    # on insert, never listed in the loader's INSERT, hence not in SNAPSHOT_COLUMNS.
    managed = {"snapshot_id"}
    assert set(schema_cols) - set(mapping.SNAPSHOT_COLUMNS) == managed
    assert tuple(c for c in schema_cols if c not in managed) == mapping.SNAPSHOT_COLUMNS
    assert len(mapping.SNAPSHOT_COLUMNS) == 12


def test_stage1_field_table_matches_raw_columns():
    """I2: contract's Stage 1 field-table rows must equal clean.frame.RAW_COLUMNS, same order."""
    fields = contract_stage1_fields(CONTRACT.read_text(encoding="utf-8"))
    assert fields, "no Stage 1 table rows extracted from the contract (regex/heading drifted?)"
    assert fields == list(RAW_COLUMNS)


def test_stage2_derived_list_matches_derived_columns():
    """I2: contract's Stage 2 derived 'plus' list must equal clean.derive.DERIVED_COLUMNS, same order."""
    derived = contract_stage2_derived(CONTRACT.read_text(encoding="utf-8"))
    assert derived, "no Stage 2 derived fields extracted from the contract (regex/heading drifted?)"
    assert derived == list(DERIVED_COLUMNS)


# --- negative: the check actually fires on drift (synthetic input only) ------

def test_ddl_comparison_ignores_guards_comments_and_indexes():
    """I13: IF NOT EXISTS guards, comments, the ALTER guard and indexes are not column drift."""
    contract_style = (
        "CREATE TABLE listings (source text NOT NULL, url text,"
        " is_active boolean NOT NULL DEFAULT true);"
    )
    schema_style = (
        "-- header comment the contract block lacks\n"
        "CREATE TABLE IF NOT EXISTS listings (source text NOT NULL, -- inline comment\n"
        "  url text, is_active boolean NOT NULL DEFAULT true);\n"
        "ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;\n"
        "CREATE INDEX IF NOT EXISTS idx_listings_zip ON listings (url);"
    )
    # Raw text differs on every one of those points; column parity must not.
    assert contract_style != schema_style
    report = diff(
        table_columns(extract_ddl_tables(contract_style), "listings"),
        table_columns(extract_ddl_tables(schema_style), "listings"),
    )
    assert report == "", report


def test_diff_detects_dropped_column():
    """I13: a column present on one side only must make the diff non-empty."""
    before = extract_ddl_tables("CREATE TABLE t (a text, b text, c text);")["t"]
    after = extract_ddl_tables("CREATE TABLE t (a text, c text);")["t"]
    report = diff(before, after)
    assert report and "b" in report, "dropped column not detected"


def test_diff_detects_reordering():
    """I12: same column set in a different order must fail — INSERT values are positional."""
    report = diff(("source", "listing_id", "url"), ("source", "url", "listing_id"))
    assert report and "order" in report, "column reorder not detected"


def test_extract_and_diff_flag_a_rename():
    """I13: a renamed column is caught end-to-end through sqlglot parse -> diff."""
    report = diff(
        extract_ddl_tables("CREATE TABLE t (price integer, note text);")["t"],
        extract_ddl_tables("CREATE TABLE IF NOT EXISTS t (price_cents integer, note text);")["t"],
    )
    assert report and "price" in report and "price_cents" in report, "rename not detected"
