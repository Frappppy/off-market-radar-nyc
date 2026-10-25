# jobs/ — run evidence (per-`run_id` folders)

**What lives here.** Every pipeline run and every manual verification session
gets a folder: the pipeline writes `raw/`, `cleaned/`, `store/` sub-artifacts +
`manifest.json` + `process_log.md` (data subdirs are gitignored); humans write
`evidence/` transcripts and `.md` reports. 19 folders / 169 files on disk (2026-10-25);
the git index lists 136.

**The keep-cited rule (REPO_MAP §5.10 ⭐).** A folder may be deleted **only if
no file in the repo cites it**. The cited-evidence keep-list:
`robots/` (compliance snapshots), `pg-fix-20261015-122253/` (31/31 live-DB
proof), `smoke-scrape-20261015-084632/` (the source of the site's fallback
CSV), `full-scrape-20261016{,b}/` (PerimeterX block proof),
`full-harvest-20261023/` (the dataset the live site serves: 22,317 rows plus
`store/verification.md` and `store/site-live-check.md`),
`push-to-deploy-20261017/`, `tier1-migration-apply/`, and the `evidence/*.md`
reports of the `tier1-{ui-check,ui-fixes,cls-fix,cls-diagnosis,panel-verify,
deployed-qa,gate-fixes}` sessions. Markdown under `evidence/` is deliberately
**not** gitignored (`.gitignore` `!jobs/*/evidence/*.md`); raw screenshots and
session state are.

**Deletions are git-recoverable.** The Phase-5a cleanup removed 44 uncited
files (superseded `pg-fix-20261015-122203/`, two failed first runs,
`tier1-migration-check/`, 12 `debug_*.py`, 3 probes, 1 PNG). Nothing is
committed, so every one of them restores with `git checkout -- <path>`.

**The one trap.** Before deleting *anything* here, grep the repo for the path —
including other `evidence/` files, which cite each other. A file with zero
citations is deletable; a cited one is the audit trail that backs a README
claim.
