#!/usr/bin/env python3
"""WHAT:      T0-header + test-anchor guardrail — exit 1 if a code file lacks
           its T0 "WHAT:" header, OR if a "Verified by:"/"TESTED BY:" claim
           names a pytest function that no def under tests/ provides
           (phantom anchor); prints EVERY violation, not just the first.
WHY:       D2 / REFACTOR_PLAN.md §5 Phase 4+6: every maintained code file must
           orient a cold reader in place and every rule must anchor to a test
           that exists — CI fails a dropped header or a hallucinated
           "Verified by: test_..." anchor instead of rotting silently. Both
           legs proven by the Phase-6 deliberate-failure gates (headerless /
           phantom temp file -> exit 1, path/token named); the CI step is
           pinned by tests/test_workflow_yaml.py (test_checks_workflow_*).
           Anchor discriminator — when is test_-shaped text a FUNCTION claim?
           * Word-boundary token, not path-attached: `tests/test_scrape.py` /
             `test_foo.py` (token right after "/" or ".") are FILE references,
             not claims — skipped. Any other `test_[A-Za-z0-9_]+` on a claim
             line must match `def <token>` SOMEWHERE under tests/ (cross-file
             fine); `test_foo*` = family claim, some def must start with it.
           * No such token — NOTHING (gap), shots/...json -> key, TS — ...,
             CHECK 2, checks E1-E3 — not function claims: ignored (tree uses
             all of them legitimately).
           * Comment-prefixed lines (#, //, --) join a claim only while its
             tail is open (ends "(", "," or "+", or the marker ends the line).
INPUTS:    tracked files from `git ls-files` — the header leg's exclusions
           and ghost-path skipping, unchanged; optional path args; tests/ disk.
OUTPUTS:   one line per missing T0 header and per phantom test anchor on
           stdout; exit 0 = clean, 1 = any violation (or a named missing path).
CALLERS:   .github/workflows/checks.yml (CI); humans by hand.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

HEADER_MARKER = "WHAT:"
# Tightest bound that passes today's whole tracked tree: the Phase-4 sweep put
# "WHAT:" on line 1 of every headered file except docstring-after-shebang Python
# files, which put it on line 2 (surveyed 2026-10-22: max WHAT: line = 2).
HEADER_LINES = 2

CODE_EXTENSIONS = {".py", ".ts", ".tsx", ".sql", ".yml", ".yaml"}

# --- exclusions: each the minimum needed; none of these is maintained code ---
# jobs/ holds evidence artifacts (run outputs, kept-cited probe scripts), not
# code — jobs/README.md documents that rule. Whole prefix: no file under it is
# maintained code (10 headerless tracked .py/.sql artifacts today).
EXCLUDED_JOBS = "jobs/"
# Next.js regenerates this file; its own body says "should not be edited" and
# site/.gitignore ignores it. Minimum: the single exact path.
EXCLUDED_NEXT_ENV = "site/next-env.d.ts"
# Neon CLI tool config (~20 lines of defineConfig), not project code — kept
# unheadered by the Phase-4 sweep. Minimum: the single exact path.
EXCLUDED_NEON = "site/neon.ts"
# Vendored dependencies: never hand-written, gitignored and untracked; listed
# only so a force-added file can never fail the check. Minimum: the prefix.
EXCLUDED_NODE_MODULES = "site/node_modules/"
# Next.js build output: generated, gitignored, untracked — same rationale as
# node_modules. Minimum: the prefix.
EXCLUDED_NEXT_BUILD = "site/.next/"

EXCLUDED_EXACT = {EXCLUDED_NEXT_ENV, EXCLUDED_NEON}
EXCLUDED_PREFIXES = (EXCLUDED_JOBS, EXCLUDED_NODE_MODULES, EXCLUDED_NEXT_BUILD)

# --- anchor check: claims naming a pytest-style test function (see WHY) ------
CLAIM_MARKERS = ("Verified by:", "TESTED BY:")
WRAP_PREFIXES = ("#", "//", "--")  # wrapped-claim continuation comment prefix
WRAP_OPEN_TAIL = ("(", ",", "+")  # ...joined only while the claim tail is open
# Word-boundary lookbehind; "/" before the token = path component (file ref).
TEST_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_/])test_[A-Za-z0-9_]+")
FILE_REF_RE = re.compile(r"\.[A-Za-z]")  # token + `.py` = file reference
DEF_RE = re.compile(r"^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)", re.M)


def is_excluded(rel_posix: str) -> bool:
    return rel_posix in EXCLUDED_EXACT or rel_posix.startswith(EXCLUDED_PREFIXES)


def tracked_files() -> list[str]:
    """Paths from `git ls-files` (repo-root-relative, posix)."""
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"],
        capture_output=True,
        check=True,
    ).stdout
    return [p.decode("utf-8", "replace") for p in out.split(b"\0") if p]


def has_header(path: Path) -> bool:
    """True if HEADER_MARKER appears within the first HEADER_LINES lines."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            head = [next(fh, "") for _ in range(HEADER_LINES)]
    except OSError:
        return False
    return any(HEADER_MARKER in line for line in head)


def find_phantom_anchors(files: list[Path]) -> list[str]:
    """One report line per function-claim token no def under tests/ satisfies
    (the def may live in any tests/ file; non-function anchors: see WHY)."""
    defs: set[str] = set()
    for p in (ROOT / "tests").rglob("*.py"):
        try:
            defs.update(DEF_RE.findall(p.read_text("utf-8", "replace")))
        except OSError:
            pass
    out: list[str] = []
    for path in files:
        try:
            lines = path.read_text("utf-8", "replace").splitlines()
        except OSError:
            continue
        i = 0
        while i < len(lines):
            mk = next((m for m in CLAIM_MARKERS if m in lines[i]), None)
            if mk is None:
                i += 1
                continue
            lineno, seg, i = i + 1, lines[i].split(mk, 1)[1], i + 1
            while i < len(lines) and (
                not (t := seg.rstrip()) or t.endswith(WRAP_OPEN_TAIL)
            ) and lines[i].lstrip().startswith(WRAP_PREFIXES):
                seg += "\n" + lines[i]
                i += 1
            for m in TEST_TOKEN_RE.finditer(seg):
                if FILE_REF_RE.match(seg, m.end()):
                    continue  # file reference: `test_foo.py`
                tok, family = m.group(0), seg[m.end():m.end() + 1] == "*"
                hit = tok in defs or family and any(d.startswith(tok) for d in defs)
                if hit:
                    continue
                at = lineno + seg.count("\n", 0, m.start())  # true token line
                spec = tok + "*" if family else tok
                out.append(f"PHANTOM test anchor: {path}:{at}: {tok} claims "
                           f"{spec} but no def matches under tests/")
    return out


def collect(args: list[str]) -> list[Path]:
    """Default: tracked, existing, non-excluded code files (ghost paths —
    tracked but deleted from disk, e.g. Phase 5a's unstaged D deletions — are
    skipped: a check that fails on files nobody can see is worse than none).
    With args: dirs are walked by the same rule; explicitly named files are
    checked as-named regardless of extension."""
    if not args:
        return [
            ROOT / p
            for p in tracked_files()
            if Path(p).suffix in CODE_EXTENSIONS
            and not is_excluded(p)
            and (ROOT / p).is_file()
        ]
    files: list[Path] = []
    for raw in args:
        p = Path(raw)
        if p.is_dir():
            files += [
                q
                for q in sorted(p.rglob("*"))
                if q.is_file()
                and q.suffix in CODE_EXTENSIONS
                and not is_excluded(q.as_posix())
            ]
        elif p.is_file():
            files.append(p)
        else:
            print(f"error: no such path: {p}", file=sys.stderr)
    return files


def main(argv: list[str]) -> int:
    if argv and any(not (Path(a).is_file() or Path(a).is_dir()) for a in argv):
        return 1
    files = collect(argv)
    violations = [p for p in files if not has_header(p)]
    for p in violations:
        print(
            f"MISSING T0 header ({HEADER_MARKER!r} within first "
            f"{HEADER_LINES} lines): {p}"
        )
    phantoms = find_phantom_anchors(files)
    for line in phantoms:
        print(line)
    if violations:
        print(f"{len(violations)} file(s) missing a T0 header.")
        return 1
    if phantoms:
        print(f"{len(phantoms)} phantom test anchor(s) naming no test in tests/.")
        return 1
    print(f"OK: {len(files)} code file(s) carry a T0 header; all test "
          f"anchors resolve under tests/.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
