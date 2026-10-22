#!/usr/bin/env python
"""WHAT:      Stage-4 contract verification — CHECK 1: sqlglot parses
           dashboard/views.sql as Postgres; CHECK 2: every table/column
           referenced by the views exists in the docs/data_contract.md DDL
           (per-reference records + a sqlglot qualify() gate); CHECK 3:
           build_guide.md <-> dax_measures.dax <-> views.sql cross-check
           (every bracketed guide reference is a measure or view column, every
           measure is referenced in the guide, every DAX 'view'[column] exists).
WHY:       The Power BI layer reads hand-written SQL/DAX that no pytest covers;
           this script is the 54-assertion gate that must pass 54/54 (exit 0)
           before those artefacts are trusted. Run: dashboard/verify_contract.py.
INPUTS:    dashboard/views.sql, dashboard/dax_measures.dax,
           dashboard/build_guide.md, docs/data_contract.md.
OUTPUTS:   per-check PASS/FAIL records + SUMMARY; exit 0 = all passed, else 1.
CALLERS:   humans / agents before shipping dashboard or SQL changes.
TESTED BY: none (not pytest) — the script's own CHECK 1/2/3 records are the gate.
"""

import re
import sys
from pathlib import Path

import sqlglot
from sqlglot import exp, parse, parse_one
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import build_scope

if hasattr(sys.stdout, "reconfigure"):  # Windows cp1252 consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
VIEWS_SQL = ROOT / "dashboard" / "views.sql"
DAX = ROOT / "dashboard" / "dax_measures.dax"
GUIDE = ROOT / "dashboard" / "build_guide.md"
CONTRACT = ROOT / "docs" / "data_contract.md"

results = []  # (check_id, ok: bool, message)


def record(check_id, ok, message):
    results.append((check_id, ok, message))
    print(f"[{check_id}] {'PASS' if ok else 'FAIL'} — {message}")


# --- CHECK 1: sqlglot parses views.sql as Postgres ---
print("== CHECK 1: sqlglot parse (dialect='postgres') ==")
views_sql = VIEWS_SQL.read_text(encoding="utf-8")
try:
    statements = parse(views_sql, dialect="postgres")
    record("1", True, f"sqlglot.parse(open('dashboard/views.sql').read(), "
                      f"dialect='postgres') → parsed OK ({len(statements)} statements)")
except sqlglot.errors.SqlglotError as exc:
    record("1", False, f"parse error: {exc}")
    print("\nRESULT: FAIL")
    sys.exit(1)

# --- build the contract schema from docs/data_contract.md (Stage 3 DDL) ---
contract_text = CONTRACT.read_text(encoding="utf-8")
ddl_schema = {}   # table -> {column: type}
ddl_order = []
for m in re.finditer(r"CREATE TABLE (\w+)\s*\((.*?)\);", contract_text, re.S):
    table_name, body = m.group(1), m.group(2)
    create = parse_one(f"CREATE TABLE {table_name} ({body});", dialect="postgres")
    cols = {}
    for coldef in create.this.expressions:
        if isinstance(coldef, exp.ColumnDef):
            kind = coldef.args.get("kind")
            cols[coldef.name] = kind.sql(dialect="postgres") if kind else "TEXT"
    ddl_schema[table_name] = cols
    ddl_order.append(table_name)

print("\n== CHECK 2: views.sql references vs docs/data_contract.md DDL ==")
print(f"DDL tables parsed from contract: {ddl_order}")

create_stmts = [s for s in statements if isinstance(s, exp.Create)]
view_columns = {}   # view name -> set of output columns
table_refs = []     # ordered unique table names referenced in views
column_refs = []    # ordered unique (table, column) references


def add_unique(seq_list, item):
    if item not in seq_list:
        seq_list.append(item)


def subquery_outputs(scope):
    """Output column names of a subquery/CTE scope (SELECT list aliases)."""
    out = set()
    for e in scope.expression.expressions:
        if isinstance(e, exp.Star):
            return None  # star: cannot resolve statically
        out.add(e.alias_or_name)
    return out


for stmt in create_stmts:
    view_name = stmt.this.name
    select = stmt.args["expression"]
    outputs = set()
    for e in select.expressions:
        outputs.add(e.alias_or_name)
    view_columns[view_name] = outputs

    root = build_scope(select)
    for scope in root.traverse():
        # -- table references (FROM clause of this scope) ------------------
        for alias, src in scope.sources.items():
            if isinstance(src, exp.Table):
                add_unique(table_refs, src.name)

        # -- column references local to this scope -------------------------
        for col in list(scope.local_columns) + list(scope.unqualified_columns):
            tname = col.table
            if tname:
                src = scope.sources.get(tname)
                if src is None:
                    record("2", False,
                           f"view {view_name}: column {tname}.{col.name} — "
                           f"alias not found among sources {sorted(scope.sources)}")
                    continue
                if isinstance(src, exp.Table):
                    add_unique(column_refs, (src.name, col.name))
                else:  # subquery / CTE source -> must match its outputs
                    outs = subquery_outputs(src)
                    if outs is None:
                        record("2", False,
                               f"view {view_name}: {tname}.{col.name} — "
                               f"subquery source uses SELECT *, cannot verify")
                    elif col.name not in outs:
                        record("2", False,
                               f"view {view_name}: {tname}.{col.name} — subquery "
                               f"does not output column {col.name!r}")
                    else:
                        add_unique(column_refs, (f"<subquery {tname}>", col.name))
            else:  # unqualified: attribute to the scope's single source
                if len(scope.sources) != 1:
                    record("2", False,
                           f"view {view_name}: unqualified column {col.name} with "
                           f"sources {sorted(scope.sources)} — ambiguous")
                    continue
                alias, src = next(iter(scope.sources.items()))
                if isinstance(src, exp.Table):
                    add_unique(column_refs, (src.name, col.name))
                else:
                    outs = subquery_outputs(src)
                    if outs is None or col.name not in outs:
                        record("2", False,
                               f"view {view_name}: unqualified column {col.name} "
                               f"not found in subquery outputs")
                    else:
                        add_unique(column_refs, (f"<subquery {alias}>", col.name))

# report table references
for t in table_refs:
    record("2", t in ddl_schema, f"table {t}")

# report column references (skip pseudo-entries for subquery outputs; those
# columns were already checked against the inner table by the inner scope)
for t, c in column_refs:
    if t.startswith("<subquery"):
        record("2", True, f"subquery output {c}")
        continue
    if t not in ddl_schema:
        record("2", False, f"column {t}.{c} — table {t} not in contract DDL")
    else:
        record("2", c in ddl_schema[t], f"column {t}.{c}")

# secondary hard gate: sqlglot qualify() against the contract schema
# Verified by: CHECK 2 (this script's qualify() record).
qualify_errors = []
for stmt in create_stmts:
    try:
        qualify(stmt.args["expression"], schema=ddl_schema, dialect="postgres")
    except Exception as exc:  # sqlglot raises several optimizer error types
        qualify_errors.append(f"{stmt.this.name}: {type(exc).__name__}: {exc}")
record("2", not qualify_errors,
       "sqlglot.qualify(views, schema=contract DDL) — no unresolved identifiers"
       if not qualify_errors else "; ".join(qualify_errors))

# --- CHECK 3: guide <-> DAX <-> views cross-check (the print below states it) ---
print("\n== CHECK 3: measure / column cross-check (guide <-> DAX <-> views) ==")

dax_text = DAX.read_text(encoding="utf-8")
dax_measures = {}
for line in dax_text.splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("//"):
        continue
    m = re.match(r"^(.+?)\s*=\s*(.+)$", stripped)
    if not m:
        record("3", False, f"unparseable DAX line: {stripped!r}")
        continue
    dax_measures[m.group(1).strip()] = m.group(2).strip()
print(f"measures defined in dax_measures.dax: {sorted(dax_measures)}")

guide_text = GUIDE.read_text(encoding="utf-8")
guide_text_nolinks = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", guide_text)
guide_brackets = re.findall(r"\[([^\]]+)\]", guide_text_nolinks)

all_view_columns = set()
for cols in view_columns.values():
    all_view_columns |= cols

# direction: every bracketed reference in the guide must be a defined measure
# or a view column (the guide's convention — see top of build_guide.md)
# Verified by: CHECK 3 (this script's guide-reference records).
for ref in dict.fromkeys(guide_brackets):
    if ref in dax_measures:
        record("3", True, f"guide reference [{ref}] → defined in dax_measures.dax")
    elif ref in all_view_columns:
        record("3", True, f"guide reference [{ref}] → view column")
    else:
        record("3", False, f"guide reference [{ref}] → NOT a measure and NOT a view column")

# direction: every DAX measure must be referenced in the guide
for name in dax_measures:
    record("3", f"[{name}]" in guide_text,
           f"measure {name} referenced in build_guide.md as [{name}]")

# every 'table'[column] used by the DAX must exist in that view
for tbl, col in dict.fromkeys(re.findall(r"'(\w+)'\s*\[\s*([^\]]+?)\s*\]", dax_text)):
    if tbl not in view_columns:
        record("3", False, f"DAX references '{tbl}'[{col}] — view not defined in views.sql")
    else:
        record("3", col in view_columns[tbl],
              f"DAX column '{tbl}'[{col}] exists in view {tbl}")

# ---------------------------------------------------------------------------
print("\n== SUMMARY ==")
failed = [r for r in results if not r[1]]
passed = [r for r in results if r[1]]
print(f"passed: {len(passed)}   failed: {len(failed)}   total: {len(results)}")
if failed:
    for cid, _, msg in failed:
        print(f"  FAIL [{cid}] {msg}")
    print("RESULT: FAIL")
    sys.exit(1)
print("RESULT: ALL CHECKS PASSED")
sys.exit(0)
