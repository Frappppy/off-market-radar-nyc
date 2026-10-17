# Push-to-deploy verification — 2026-10-17

Raw record behind the README's **Deploy mechanics** section. Every deployment id, state and
HTTP code below was read from the Vercel API or `curl` during this session; nothing here is
inferred. All times are UTC (the host clock is UTC+6).

**Question being settled.** For the whole build, `git push` neither built nor deployed this
repo (`jobs/tier1-gate-fixes/evidence/gate-fixes.md` §9.7 recorded that). The user installed
the Vercel GitHub App on `Frappppy/off-market-radar-nyc`; this file records whether that
actually wired the pipeline, and what else it changed.

---

## 1. The connection — read from the API, not the CLI

`vercel git connect --yes --project off-market-radar-nyc` returned exit 0 with
`Connecting GitHub repository: https://github.com/Frappppy/off-market-radar-nyc` /
`Connected`. **That is not the proof** — the exit code was misleading earlier in the same
investigation, when the same command failed. The authoritative check is the API:

```
GET /v9/projects/prj_lZtIBrfxq0TehcMulRyjF4ijQifY?teamId=team_WNXfrRLYe1daExSxWFgXIteV
```

| field | value |
|---|---|
| `name` | `off-market-radar-nyc` |
| `rootDirectory` | `site` |
| `framework` | `nextjs` |
| `gitForkProtection` | `true` |
| `link.type` | `github` |
| `link.org` | `Frappppy` |
| `link.repo` | `off-market-radar-nyc` |
| `link.repoId` | `1421686985` |
| `link.productionBranch` | `main` |
| `link.deployHooks` | `0` |

**Trap worth keeping:** `vercel project inspect off-market-radar-nyc --json` omits the
`link` object entirely, so it reported `link = (none)` for a project that was, in fact,
connected. `vercel project inspect` does report `Root Directory  site`.

## 2. Push → production, observed three times

| push | commit | deployment | state | source | target | created (UTC) |
|---|---|---|---|---|---|---|
| pipeline test (empty commit) | `3495fea` | `dpl_9wcKJJhChPefgAfgKrXYa4Xwt478` | `READY` | `git` | `production` | 08:14:46 (pushed 08:14:39 — **7 s**) |
| docs correction | `cc67efa` | `dpl_W2PBmfwxHLaYdWE91D8w8YANrFbv` | `READY` | `git` | `production` | 08:31:45 |
| docs correction | `2537149` | *(alias confirmed)* | `READY` | `git` | `production` | 08:38:08 |

No `vercel deploy` was run for any of the three. The production alias
`off-market-radar-nyc.vercel.app` moved each time:
`off-market-radar-80u84hga7-…` → `off-market-radar-e74k9oz05-…` →
`off-market-radar-lgu4qd0ll-…`.

The first push was an empty commit deliberately: it changed no files, so a deployment
appearing 7 seconds later cannot be explained by anything except the push.

**Why the CLI's own deployments do not falsify this.** The earlier CLI deploys also carry a
commit SHA and branch (see §3), so the deployment list alone is ambiguous. The discriminator
is the top-level `source` field, and the fact that no CLI command was run in these windows.

## 3. git-triggered vs CLI-triggered — the exact discriminator

`GET /v13/deployments/<id>` for the push-triggered `dpl_9wcKJJhChPefgAfgKrXYa4Xwt478`
against the CLI-created `dpl_FuzAiwPgnQTjorvhaRPVWgw4839f`:

```
source: push=git  cli=cli
```

**`meta` keys present ONLY on the push (App) deployment** — 9 keys:

```
branchAlias
githubCommitAuthorLogin
githubCommitRepoId
githubCommitVerification
githubHost
githubRepoId
githubRepoOwnerType
githubRepoVisibility
repoPushedAt
```

**`meta` keys present ONLY on the CLI deployment** — 3 keys:

```
actor
gitDirty
gitRootDirectory
```

**Shared keys (therefore worthless as evidence)** — 11 keys:

```
githubCommitAuthorEmail  githubCommitAuthorName  githubCommitMessage
githubCommitOrg          githubCommitRef        githubCommitRepo
githubCommitSha          githubDeployment       githubOrg
githubRepo               lambdaRuntimeStats
```

Observed values:

| key | push `dpl_9wcKJJ…` | CLI `dpl_FuzAiw…` |
|---|---|---|
| `actor` | *(absent)* | `opencode` |
| `gitDirty` | *(absent)* | `1` |
| `gitRootDirectory` | *(absent)* | `site` |
| `branchAlias` | `off-market-radar-nyc-git-main-frappppy.vercel.app` | *(absent)* |
| `githubHost` | `github.com` | *(absent)* |
| `githubRepoVisibility` | `public` | *(absent)* |
| `githubCommitRef` | `main` | `main` |
| `githubRepo` | `off-market-radar-nyc` | `off-market-radar-nyc` |
| `githubOrg` | `Frappppy` | `Frappppy` |
| `githubDeployment` | `1` | `1` |

This corrects a claim previously made in `README.md`: that a CLI deploy was
*"dashboard-indistinguishable from a Git-triggered build"*. The two are distinguishable —
just not by SHA, branch, repo, org or message, all of which the CLI stamps from local git.

## 4. Branch previews — four experiments

| # | branch | commit | result |
|---|---|---|---|
| 1 | `pipeline-preview-test` | `3495fea` (already deployed to production) | **no deployment at all** over a ~3.5 min watch |
| 2 | `preview-verify` | `f1fdea7` | `dpl_8xdcWxYpif62bycKyNKaoY24WhBz`, `target=preview`, first seen `BUILDING` |
| 3 | `preview-verify2` | `5acf286` | `dpl_DrXEH2DNAmtjT3CBftNairSVfMd6`, reached `READY` in ≈40–50 s |
| 4 | `preview-probe` | `3c0d9b5` | reached `READY`; URL `off-market-radar-8x1gr8nxs-frappppy.vercel.app` |

Experiment 1 is the trap: a branch cut from the tip of `main` points at a SHA Vercel has
already built, and duplicate-SHA builds are skipped by design. This looks exactly like a
broken integration until the SHA is checked.

All four branches were deleted afterwards, and every preview deployment was deleted after
reaching `READY`.

### The spurious failure email

Experiment 2's preview was deleted **while still `BUILDING`** (found building at 08:25:39,
deleted at ≈08:25:45 — an over-eager cleanup). Vercel recorded the cancellation as the
build's outcome and emailed:

> **Preview deployment failed** — Build error: *Deployment not found. Was it deleted?* —
> Failed at: October 17, 2026 at 8:26 AM UTC

`GET /v13/deployments/dpl_8xdcWxYpif62bycKyNKaoY24WhBz` now returns **404**, and a deleted
deployment does not appear in the project's deployment list — so there was no failed build
to inspect. The email describes the deletion, not a pipeline fault. **Deleting after
`READY` is clean and silent** (verified twice, experiments 3 and 4).

## 5. Preview reachability — with production as the control

Project settings: `ssoProtection = {"deploymentType":"all_except_custom_domains"}`,
`passwordProtection` unset, `gitForkProtection = true`.

Anonymous `curl` (no credentials), same instant, one year-of-record apart:

```
PRODUCTION: code=200 redirect=
PREVIEW   : code=302 redirect=https://vercel.com/sso-api?url=https%3A%2F%2Foff-market-radar-8x1gr8nxs-frappppy.vercel.app%2F&nonce=…
```

So preview deployments build and reach `READY`, but are **not publicly reachable** — they
bounce to Vercel Authentication. They are for people signed in to the team, not shareable
links. (The `main`-branch alias `off-market-radar-nyc-git-main-frappppy.vercel.app` behaves
the same way: `302` to the same SSO endpoint.)

## 6. State after the round

- `HEAD == origin/main == 2537149` at the time of writing; working tree clean.
- Remote branches: `main` only — every experiment branch deleted (local and remote).
- Deployment protection unchanged; no project setting was modified by this work.
- No credentials were written to any file: `DATAIMPULSE_*` and `VERCEL_*` values live in
  gitignored `site/.env*.local`, never in the repo. The Vercel CLI token was read from
  `%APPDATA%\com.vercel.cli\Data\auth.json` into a variable and never printed.

## 7. Live verification on the push-deployed build

Run against `https://off-market-radar-nyc.vercel.app` after the git-triggered deploy, to
confirm the pipeline shipped the same verified artifact rather than merely a green light:

```
navfix.js    VERDICT navCarriesQuery=true navFilterHolds=true sawZeroClaim=false
frozencls.js VERDICT {"allStable":true,"worstFrozenCls":0.00924,"anyOverBudget":false,
                      "compactPillBelowSm":true,"fullPillAtSm":true}
trendstates.js VERDICT {"loadingShowsEllipsis":true,"loadingMakesNoZeroClaim":true,
                        "loadedShowsRealCount":true,"errorDoesNotClaimZero":true,
                        "errorSaysError":true,"errorSummarySaysError":true}
```

## 8. Caveats — what this file does not establish

- The `preview-probe` deployment's `uid` was not captured (its URL is recorded instead).
- The first anonymous fetch of a preview URL (experiment 3) threw on a PowerShell null-header
  bug, so its status code was not read. §5's result comes from the `curl` re-run, which is
  the one quoted.
- Preview deployments being team-gated is a **project setting**, not a plan limit; it can be
  changed, and was deliberately left alone (security-relevant, the user's call).
- Only `dpl_FuzAiwPgnQTjorvhaRPVWgw4839f`'s `source=cli` was read directly. The other
  pre-App deployments are assumed CLI-sourced from their timing, not verified.

## Reproduction

```bash
# connection (API — the CLI hides `link`)
GET /v9/projects/prj_lZtIBrfxq0TehcMulRyjF4ijQifY?teamId=team_WNXfrRLYe1daExSxWFgXIteV

# what a deployment actually is
GET /v13/deployments/<deployment-id>?teamId=team_WNXfrRLYe1daExSxWFgXIteV   # -> .source, .meta
GET /v6/deployments?projectId=prj_lZtIBrfxq0TehcMulRyjF4ijQifY&teamId=…&limit=10

# preview reachability, production as control
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" https://off-market-radar-nyc.vercel.app/
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" https://<preview-url>/
```

See `jobs/tier1-gate-fixes/evidence/gate-fixes.md` §9.7 for the earlier experiment that
proved the pipeline was **not** wired, and its dated correction.
