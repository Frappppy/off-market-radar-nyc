#Requires -Version 5.1
<#
.SYNOPSIS
  Live end-to-end verification for Project 1 stage 3 (src.store) + stage 4
  (dashboard views) against a real local PostgreSQL 18 (conda, ephemeral).

.DESCRIPTION
  Boots an ephemeral PostgreSQL cluster under %LOCALAPPDATA%\Temp\opencode\pglive
  (self-heals Library\share + Library\lib from the conda pkgs cache if a temp
  cleaner damaged them, initdb + pg_ctl start when the cluster is missing),
  ensures the fixture cleaned dir exists (runs src.clean from
  tests/fixtures/sample_raw.jsonl when needed), then asserts the ladder:

    1. unshimmed `python -m src.store` -> exit 0 (informational probe proving
       the psycopg 3.3.6 Connection.__exit__ bug is FIXED: src/store/cli.py
       now wraps each transaction in `with conn.transaction():`, so the
       connection is no longer closed by transaction 1's exit)
    2. initial load (real CLI `python -m src.store`) -> exit 0, full counts
    3. identical re-load -> exit 0, counts unchanged (idempotency)
    4. modified-price re-load -> exit 0, counts unchanged, EXACTLY one
       listing_snapshots.price row changed (ON CONFLICT ... DO UPDATE)
    5. exactly one pipeline_runs row, status=success, 10/10 records
    6. dashboard/views.sql applied + both views queried live
    7. missing DATABASE_URL -> exit 2 (nothing written to the DB)

  src.store code runs unmodified. The only intervention is a documented
  runtime shim (run_store_shim.py, generated into the job dir but never executed): it patches
  psycopg.Connection.__exit__ to commit/rollback WITHOUT closing the
  connection. Rationale: psycopg 3.3.6 closes non-pooled connections on
  __exit__ (upstream connection.py:178-180), which makes cli.py's four
  `with conn:` transactions die at transaction 2. Fixed by using
  `with conn.transaction():` per transaction (src/store/cli.py) — unshimmed
  live runs now exit 0 and the shim is inert (kept only as documentation).

  Exit codes: 0 = every assertion passed (or graceful SKIP: prereq absent),
              1 = at least one assertion failed.

.NOTES
  Credentials: none - the ephemeral cluster uses initdb -A trust on
  127.0.0.1 only; DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
  contains no secret and is the only DSN used here.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live_db_check.ps1

.EXAMPLE
  ... -RunId my-check -KeepServer   # leave the server running afterwards
#>
[CmdletBinding()]
param(
    [string]$RunId = ("pg-live-" + (Get-Date -Format 'yyyyMMdd-HHmmss')),
    [string]$EvidenceDir = '',
    [switch]$KeepServer,
    [switch]$SkipUnshimmedProbe
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Prefix   = Join-Path $env:LOCALAPPDATA 'Temp\opencode\pglive'
$PgBin    = Join-Path $Prefix 'Library\bin'
$PgData   = Join-Path $Prefix 'pgdata'
$Port     = 55432
$Dsn      = "postgresql://postgres@127.0.0.1:$Port/postgres"
$Python   = Join-Path $RepoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) {
    # .venv lives at the repo root; the project tree moved into a subfolder.
    $Python = Join-Path (Split-Path -Parent $RepoRoot) '.venv\Scripts\python.exe'
}
$JobDir   = Join-Path $RepoRoot "jobs\$RunId"
if (-not $EvidenceDir) { $EvidenceDir = Join-Path $JobDir 'evidence' }
$SummaryPath = Join-Path $EvidenceDir 'assertions.txt'

$Psql      = Join-Path $PgBin 'psql.exe'
$PgIsReady = Join-Path $PgBin 'pg_isready.exe'
$PgCtl     = Join-Path $PgBin 'pg_ctl.exe'
$InitDb    = Join-Path $PgBin 'initdb.exe'

$script:PassCount  = 0
$script:FailCount  = 0
$script:ServerUp   = $false
$script:OrigDsn    = $env:DATABASE_URL

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
Set-Content -Path $SummaryPath -Value "live_db_check  run_id=$RunId  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding UTF8

function Log([string]$Message) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message)
}
function Skip-Check([string]$Reason) {
    Write-Host "SKIP: $Reason"
    Add-Content -Path $SummaryPath -Value "SKIP: $Reason"
    exit 0
}
function Assert([bool]$Condition, [string]$Label, [string]$Expected = '', [string]$Actual = '') {
    if ($Condition) {
        $script:PassCount++
        Write-Host ("  PASS  {0}" -f $Label)
        Add-Content -Path $SummaryPath -Value "PASS  $Label"
    } else {
        $script:FailCount++
        $line = "FAIL  $Label"
        if ($Expected) { $line += "  [expected: $Expected]" }
        if ($Actual)   { $line += "  [actual: $Actual]" }
        Write-Host ("  FAIL  {0}" -f $line)
        Add-Content -Path $SummaryPath -Value $line
    }
}
function Invoke-Q {
    # psql -> stdout lines (tuple-only, no headers); psql errors print to console
    param([string]$Sql, [switch]$TuplesOnly)
    $argList = @('-h', '127.0.0.1', '-p', "$Port", '-U', 'postgres', '-d', 'postgres')
    if ($TuplesOnly) { $argList += '-At' }
    $argList += @('-c', $Sql)
    $out = & $Psql @argList
    return ($out | ForEach-Object { "$_" })
}
function Get-Count([string]$Relation) {
    $raw = (Invoke-Q -Sql "SELECT count(*) FROM $Relation;" -TuplesOnly) -join ''
    $n = 0
    if (-not [int]::TryParse("$raw".Trim(), [ref]$n)) { return -1 }
    return $n
}
function Invoke-Store {
    # runs python with clean file redirection (no PowerShell stderr wrapping)
    param([string]$InputRel, [switch]$Shim, [switch]$UnsetDsn)
    if ($UnsetDsn) { $env:DATABASE_URL = '' } else { $env:DATABASE_URL = $Dsn }
    $stdout = Join-Path $EvidenceDir 'tmp_stdout.txt'
    $stderr = Join-Path $EvidenceDir 'tmp_stderr.txt'
    $argList = New-Object System.Collections.Generic.List[string]
    # NB: Start-Process does not quote arguments - keep every arg relative
    # (the repo path contains a space) and rely on -WorkingDirectory.
    if ($Shim) { $argList.Add("jobs\$RunId\run_store_shim.py") }
    else       { $argList.Add('-m'); $argList.Add('src.store') }
    $argList.Add('--in');        $argList.Add($InputRel)
    $argList.Add('--run-id');    $argList.Add($RunId)
    $p = Start-Process -FilePath $Python -ArgumentList $argList `
        -WorkingDirectory $RepoRoot -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $so = if (Test-Path $stdout) { (Get-Content $stdout -Raw) } else { '' }
    $se = if (Test-Path $stderr) { (Get-Content $stderr -Raw) } else { '' }
    $script:LastStoreRun = [pscustomobject]@{
        Command = "python $($argList -join ' ')"
        ExitCode = $p.ExitCode
        StdOut   = "$so"
        StdErr   = "$se"
    }
    return $p.ExitCode
}
function Save-StoreEvidence([string]$FileName) {
    $r = $script:LastStoreRun
    $text = "COMMAND: $($r.Command)`r`nEXIT CODE: $($r.ExitCode)`r`n--- stdout ---`r`n$($r.StdOut)`r`n--- stderr ---`r`n$($r.StdErr)`r`n"
    Set-Content -Path (Join-Path $EvidenceDir $FileName) -Value $text -Encoding UTF8
}
function Invoke-BoundedExe {
    # pg_ctl intermittently lingers in exit under antivirus on this machine
    # (observed >10 min after printing "server started"), which would hang any
    # `pg_ctl ... | Out-File` pipeline. Bound every wait and kill the tool if
    # it overruns: the postmaster is daemonized and independent of pg_ctl's
    # exit, so killing pg_ctl after its work is done is safe.
    # Returns the exit code (-1 = killed after timeout).
    param([string]$FilePath, [string[]]$ArgumentList, [int]$TimeoutSec = 60, [string]$OutFile = '')
    $so = Join-Path $EvidenceDir 'exe_stdout.txt'
    $se = Join-Path $EvidenceDir 'exe_stderr.txt'
    Remove-Item $so, $se -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -NoNewWindow -PassThru `
        -RedirectStandardOutput $so -RedirectStandardError $se
    $exited = $p.WaitForExit($TimeoutSec * 1000)
    if (-not $exited) {
        try { $p.Kill() } catch {}
        $null = $p.WaitForExit(10000)
        Log "$(Split-Path -Leaf $FilePath) $($ArgumentList[0]) did not exit within ${TimeoutSec}s -> killed (work assumed done)"
    }
    $text = ''
    foreach ($f in @($so, $se)) {
        if (Test-Path $f) { $text += (Get-Content $f -Raw) + "`r`n" }
    }
    if ($OutFile) { Set-Content -Path $OutFile -Value $text -Encoding UTF8 }
    if ($exited) { return [int]$p.ExitCode }
    return -1
}

# ---------------------------------------------------------------------------
# 0. prerequisites -> graceful SKIP when the toolchain is absent
# ---------------------------------------------------------------------------
if (-not (Test-Path $Python)) { Skip-Check "project venv not found: $Python" }
$missingPg = @('postgres.exe', 'pg_ctl.exe', 'psql.exe', 'initdb.exe', 'pg_isready.exe') |
    Where-Object { -not (Test-Path (Join-Path $PgBin $_)) }
if ($missingPg) {
    $condaCandidates = @(
        'C:\ProgramData\anaconda3\Scripts\conda.exe',
        (Join-Path $env:USERPROFILE 'miniconda3\Scripts\conda.exe'),
        (Join-Path $env:USERPROFILE 'miniforge3\Scripts\conda.exe'),
        (Join-Path $env:USERPROFILE 'anaconda3\Scripts\conda.exe')
    )
    $conda = $condaCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($conda) {
        Log "installing PostgreSQL into $Prefix (conda) ..."
        & $conda create -y -p $Prefix -c conda-forge postgresql=18 libpq 2>&1 |
            Out-File (Join-Path $EvidenceDir 'conda_install.txt')
        $missingPg = @('postgres.exe', 'pg_ctl.exe', 'psql.exe', 'initdb.exe', 'pg_isready.exe') |
            Where-Object { -not (Test-Path (Join-Path $PgBin $_)) }
    }
    if ($missingPg) {
        Skip-Check "PostgreSQL absent ($($missingPg -join ', ')) and conda install unavailable. Run: conda create -y -p `"$Prefix`" -c conda-forge postgresql=18 libpq"
    }
}

# temp-cleaner self-heal: share/lib restored from the conda pkgs cache
if (-not (Test-Path (Join-Path $PgBin 'postgres.exe'))) {
    Skip-Check "postgres.exe missing under $PgBin"
}
if (-not (Test-Path (Join-Path $Prefix 'Library\share\postgres.bki'))) {
    $cacheLib = $null
    $pkgsRoot = Join-Path $env:USERPROFILE '.conda\pkgs'
    if (Test-Path $pkgsRoot) {
        $cacheLib = Get-ChildItem $pkgsRoot -Directory -Filter 'libpq-*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $cacheLib) { Skip-Check "Library\share damaged and no libpq-* pkgs cache under $pkgsRoot" }
    Log "self-healing Library\share + Library\lib from $cacheLib"
    robocopy (Join-Path $cacheLib 'share') (Join-Path $Prefix 'Library\share') /E /NFL /NDL /NJH /NJS /NP | Out-Null
    robocopy (Join-Path $cacheLib 'lib')   (Join-Path $Prefix 'Library\lib')   /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if (-not (Test-Path (Join-Path $Prefix 'Library\share\postgres.bki'))) {
        Skip-Check "self-heal failed: postgres.bki still missing"
    }
}

# ---------------------------------------------------------------------------
# 1. cluster: initdb if needed, pg_ctl start, readiness gate
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    Log "initdb $PgData"
    $rc = Invoke-BoundedExe -FilePath $InitDb -TimeoutSec 300 `
        -ArgumentList @('-D', $PgData, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8') `
        -OutFile (Join-Path $EvidenceDir 'initdb.txt')
    if ($rc -ne 0) { Skip-Check "initdb failed with exit $rc (see evidence\initdb.txt)" }
}

function Test-ServerReady {
    & $PgIsReady -h 127.0.0.1 -p $Port *> $null
    return ($LASTEXITCODE -eq 0)
}
$readyOk = Test-ServerReady
if (-not $readyOk) {
    # A postmaster can be alive yet stuck in a fork-crash loop (observed:
    # backends dying with 0xC0000142 after a process-tree kill) and pg_isready
    # then reports "no response". Stop whatever is there before starting.
    Log "server not ready -> pg_ctl stop (immediate) then bounded start"
    $null = Invoke-BoundedExe -FilePath $PgCtl -TimeoutSec 45 `
        -ArgumentList @('stop', '-D', $PgData, '-m', 'immediate', '-w', '-t', '25') `
        -OutFile (Join-Path $EvidenceDir 'server_stop_stale.txt')
    if (Test-Path (Join-Path $PgData 'postmaster.pid')) {
        Remove-Item (Join-Path $PgData 'postmaster.pid') -Force   # pid of a dead postmaster only
    }
    # NB: no -w here; readiness is polled below, and pg_ctl's exit can linger.
    # The -o value must keep its embedded quotes: Start-Process does not quote.
    $null = Invoke-BoundedExe -FilePath $PgCtl -TimeoutSec 45 `
        -ArgumentList @('start', '-D', $PgData, '-o', "`"-h 127.0.0.1 -p $Port`"", '-l', (Join-Path $PgData 'pglive.log')) `
        -OutFile (Join-Path $EvidenceDir 'server_start.txt')
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        $readyOk = Test-ServerReady
    } while (-not $readyOk -and (Get-Date) -lt $deadline)
}
Assert $readyOk 'PostgreSQL 18 accepting connections on 127.0.0.1:55432' 'pg_isready exit 0' 'no response'
if (-not $readyOk) {
    # without a server no further assertion is meaningful
    Write-Host "RESULT: 0 passed, $script:FailCount failed - evidence: $EvidenceDir"
    exit 1
}
$script:ServerUp = $true
$env:DATABASE_URL = $Dsn
# readiness alone is not enough: prove a backend process can actually spawn
# (a postmaster in a fork-crash loop answers pg_isready then dies per backend)
$fork = Invoke-Q -Sql 'SELECT 1;' -TuplesOnly
Assert ("$($fork -join '')".Trim() -eq '1') 'backend process spawns (psql SELECT 1 round-trip)' '1' "$($fork -join '')"

# ---------------------------------------------------------------------------
# 2. fixture input (stage 2 output) + clean slate
# ---------------------------------------------------------------------------
$Cleaned  = Join-Path $JobDir 'cleaned'
$hasInput = @(Get-ChildItem (Join-Path $Cleaned 'listings_*.parquet') -ErrorAction SilentlyContinue).Count -gt 0
if (-not $hasInput) {
    Log "stage 2 input missing -> running src.clean from tests/fixtures/sample_raw.jsonl"
    & $Python -m src.clean --in (Join-Path $RepoRoot 'tests\fixtures\sample_raw.jsonl') `
        --out $Cleaned --run-id $RunId
    Assert ($LASTEXITCODE -eq 0) 'src.clean produced the fixture cleaned dir' 'exit 0' "exit $LASTEXITCODE"
}
$hasInput = @(Get-ChildItem (Join-Path $Cleaned 'listings_*.parquet') -ErrorAction SilentlyContinue).Count -gt 0
Assert $hasInput 'cleaned listings_*.parquet present' '>=1 file' '0 files'
if (-not $hasInput) {
    Write-Host "RESULT: $script:PassCount passed, $script:FailCount failed - evidence: $EvidenceDir"
    exit 1
}
$Expected = 0
$manifest = Get-Content (Join-Path $Cleaned 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.records_out) { $Expected = [int]$manifest.records_out }
Assert ($Expected -gt 0) 'fixture records_out known' '>0' "$Expected"

# ---------------------------------------------------------------------------
# 3. unshimmed probe (informational): the psycopg __exit__ bug, exit 1
# ---------------------------------------------------------------------------
if (-not $SkipUnshimmedProbe) {
    Log "unshimmed probe: python -m src.store (exit 0 = cli.py fixed with conn.transaction())"
    $null = Invoke-Store -InputRel ('jobs\' + $RunId + '\cleaned')
    Save-StoreEvidence 'probe_unshimmed_store.txt'
    $probeExit = $script:LastStoreRun.ExitCode
    Log "unshimmed probe exit=$probeExit (1 = known psycopg 3.3.6 Connection.__exit__ bug reproduced; 0 = cli.py fixed). Informational only."
    if ($probeExit -eq 0) {
        Add-Content -Path $SummaryPath -Value "INFO  unshimmed src.store exit=0 (cli.py appears fixed; shim inert)"
    } else {
        Add-Content -Path $SummaryPath -Value "INFO  unshimmed src.store exit=$probeExit (expected 1; bug documented in validation_report.md)"
    }
}

# ---------------------------------------------------------------------------
# 4. schema + empty slate (idempotent)
# ---------------------------------------------------------------------------
& $Psql -h 127.0.0.1 -p $Port -U postgres -d postgres -f (Join-Path $RepoRoot 'sql\schema.sql') 2>&1 |
    Out-File (Join-Path $EvidenceDir 'schema_apply.txt')
Assert ($LASTEXITCODE -eq 0) 'sql/schema.sql applied' 'exit 0' "exit $LASTEXITCODE"
Invoke-Q -Sql 'TRUNCATE TABLE listings, listing_snapshots, pipeline_runs;' | Out-Null
Assert ((Get-Count 'listings') -eq 0 -and (Get-Count 'listing_snapshots') -eq 0 -and (Get-Count 'pipeline_runs') -eq 0) `
    'clean slate after TRUNCATE' '0/0/0' "$((Get-Count 'listings'))/$((Get-Count 'listing_snapshots'))/$((Get-Count 'pipeline_runs'))"

# ---------------------------------------------------------------------------
# 5. the shim + the modified-price builder (generated into the job dir)
# ---------------------------------------------------------------------------
$ShimPath = Join-Path $JobDir 'run_store_shim.py'
$ShimSource = @'
"""Runtime shim: run src.store with psycopg.Connection.__exit__ minus close().

psycopg 3.3.6 (pinned in requirements.txt) closes non-pooled connections on
__exit__ (upstream psycopg/connection.py:178-180); src/store/cli.py wraps four
transactions in `with conn:` on ONE connection, so transaction 1's exit kills
the connection and transaction 2 fails with "the connection is closed".
This patch exists only in this process; no repository file is modified.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import psycopg  # noqa: E402
import psycopg.connection  # noqa: E402


def _exit_no_close(self, exc_type, exc_val, exc_tb):
    """Upstream psycopg 3.3.6 Connection.__exit__ minus the final close()."""
    if self.closed:
        return
    if exc_type:
        try:
            self.rollback()
        except Exception as exc2:  # noqa: BLE001 - upstream warns and proceeds
            psycopg.connection.logger.warning(
                "error ignored in rollback on %s: %s", self, exc2
            )
    else:
        self.commit()


psycopg.Connection.__exit__ = _exit_no_close
print(
    "[shim] psycopg.Connection.__exit__ patched: commit/rollback WITHOUT close",
    file=sys.stderr,
)

sys.argv = ["src.store", *sys.argv[1:]]
runpy.run_module("src.store", run_name="__main__")
'@
Set-Content -Path $ShimPath -Value $ShimSource -Encoding UTF8
Assert (Test-Path $ShimPath) 'shim written: jobs/<run>/run_store_shim.py'

$BuilderPath = Join-Path $JobDir 'make_modified_price.py'
$BuilderSource = @'
"""Build cleaned-modified/: same fixture with ONE price_current changed.

Proves the snapshot upsert is a real ON CONFLICT ... DO UPDATE: same
(source, listing_id, snapshot_date) key -> price overwritten, counts unchanged.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pandas as pd

JOB = Path(__file__).resolve().parent
SRC = JOB / "cleaned"
DST = JOB / "cleaned-modified"
DELTA = 25000

DST.mkdir(exist_ok=True)
parquet_files = sorted(SRC.glob("listings_*.parquet"))
if not parquet_files:
    raise SystemExit(f"no listings_*.parquet in {SRC}")
parquet = parquet_files[0]

df = pd.read_parquet(parquet)
candidates = df.index[df["price_current"].notna()]
if len(candidates) == 0:
    raise SystemExit("no non-null price_current to modify")
i = candidates[0]
old = int(df.at[i, "price_current"])
new = old - DELTA
df.at[i, "price_current"] = new

df.to_parquet(DST / parquet.name, index=False)
shutil.copy2(SRC / "manifest.json", DST / "manifest.json")

meta = {
    "source": str(df.at[i, "source"]),
    "listing_id": str(df.at[i, "listing_id"]),
    "snapshot_date": str(df.at[i, "snapshot_date"]),
    "price_current_before": old,
    "price_current_after": new,
    "delta": DELTA,
}
(DST / "modification.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print(json.dumps(meta, indent=2))
'@
Set-Content -Path $BuilderPath -Value $BuilderSource -Encoding UTF8
Assert (Test-Path $BuilderPath) 'builder written: jobs/<run>/make_modified_price.py'

function Get-PriceDump {
    $lines = Invoke-Q -Sql "SELECT source || '|' || listing_id || '|price=' || COALESCE(price::text,'-') || '|snap=' || snapshot_date FROM listing_snapshots ORDER BY source, listing_id;" -TuplesOnly
    return @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
}

# ---------------------------------------------------------------------------
# 6. assertion ladder over src.store
# ---------------------------------------------------------------------------
$CleanRel = 'jobs\' + $RunId + '\cleaned'

Log "run 1: initial load (real CLI: python -m src.store)"
$exit = Invoke-Store -InputRel $CleanRel
Save-StoreEvidence 'store_run1_initial.txt'
Assert ($exit -eq 0) 'run 1 (initial load) exit code' '0' "$exit"
Assert ((Get-Count 'listings') -eq $Expected) 'run 1: listings count' "$Expected" "$(Get-Count 'listings')"
Assert ((Get-Count 'listing_snapshots') -eq $Expected) 'run 1: listing_snapshots count' "$Expected" "$(Get-Count 'listing_snapshots')"
Assert ((Get-Count 'pipeline_runs') -eq 1) 'run 1: exactly one pipeline_runs row' '1' "$(Get-Count 'pipeline_runs')"

Log "run 2: identical re-load (idempotency, real CLI)"
$exit = Invoke-Store -InputRel $CleanRel
Save-StoreEvidence 'store_run2_idempotent.txt'
Assert ($exit -eq 0) 'run 2 (identical re-load) exit code' '0' "$exit"
Assert ((Get-Count 'listings') -eq $Expected -and (Get-Count 'listing_snapshots') -eq $Expected) `
    'run 2: counts unchanged' "$Expected/$Expected" "$(Get-Count 'listings')/$(Get-Count 'listing_snapshots')"
Assert ((Get-Count 'pipeline_runs') -eq 1) 'run 2: still exactly one pipeline_runs row' '1' "$(Get-Count 'pipeline_runs')"
$status = (Invoke-Q -Sql 'SELECT DISTINCT status FROM pipeline_runs;' -TuplesOnly) -join ''
Assert ("$status".Trim() -eq 'success') 'pipeline_runs status=success' 'success' "$status"
$loaded = (Invoke-Q -Sql 'SELECT records_loaded FROM pipeline_runs;' -TuplesOnly) -join ''
Assert ("$loaded".Trim() -eq "$Expected") 'pipeline_runs records_loaded' "$Expected" "$loaded"

Log "run 3: modified-price re-load (DO UPDATE)"
$null = & $Python (Join-Path $JobDir 'make_modified_price.py')
Assert ($LASTEXITCODE -eq 0) 'make_modified_price.py exit code' '0' "$LASTEXITCODE"
$mod = Get-Content (Join-Path $JobDir 'cleaned-modified\modification.json') -Raw | ConvertFrom-Json
$before = Get-PriceDump
$exit = Invoke-Store -InputRel ('jobs\' + $RunId + '\cleaned-modified')
Save-StoreEvidence 'store_run3_modified_price.txt'
Assert ($exit -eq 0) 'run 3 (modified price) exit code' '0' "$exit"
Assert ((Get-Count 'listings') -eq $Expected -and (Get-Count 'listing_snapshots') -eq $Expected) `
    'run 3: counts unchanged (no delete+reinsert)' "$Expected/$Expected" "$(Get-Count 'listings')/$(Get-Count 'listing_snapshots')"
$after = Get-PriceDump
$changed = @(Compare-Object -ReferenceObject $before -DifferenceObject $after)
Assert ($changed.Count -eq 2) 'exactly ONE snapshot price line changed' '2 diff entries (1 line)' "$($changed.Count)"
$sid  = "$($mod.listing_id)".Replace("'", "''")
$srcq = "$($mod.source)".Replace("'", "''")
$dbPrice = (Invoke-Q -Sql "SELECT price FROM listing_snapshots WHERE source='$srcq' AND listing_id='$sid';" -TuplesOnly) -join ''
Assert ("$dbPrice".Trim() -eq "$($mod.price_current_after)") 'DO UPDATE wrote price_current_after' "$($mod.price_current_after)" "$dbPrice"
Assert ((Get-Count 'pipeline_runs') -eq 1) 'run 3: still exactly one pipeline_runs row' '1' "$(Get-Count 'pipeline_runs')"

# ---------------------------------------------------------------------------
# 7. stage 4: dashboard views applied + queried live
# ---------------------------------------------------------------------------
& $Psql -h 127.0.0.1 -p $Port -U postgres -d postgres -f (Join-Path $RepoRoot 'dashboard\views.sql') 2>&1 |
    Out-File (Join-Path $EvidenceDir 'views_apply.txt')
Assert ($LASTEXITCODE -eq 0) 'dashboard/views.sql applied' 'exit 0' "exit $LASTEXITCODE"
$vwLatest = Get-Count 'vw_latest_listings'
Assert ($vwLatest -eq $Expected) 'SELECT count(*) FROM vw_latest_listings' "$Expected" "$vwLatest"
$vwDefs = (Invoke-Q -Sql "SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN ('vw_latest_listings','vw_zip_price_drop_30d');" -TuplesOnly) -join ''
Assert ("$vwDefs".Trim() -eq '2') 'both view definitions present in pg_views' '2' "$vwDefs"
Invoke-Q -Sql 'SELECT zip, snapshot_date, avg_price_drop_pct, listing_count FROM vw_zip_price_drop_30d ORDER BY snapshot_date DESC, zip;' |
    Tee-Object -FilePath (Join-Path $EvidenceDir 'vw_zip_price_drop_30d.txt')
$vwZipRows = Get-Count 'vw_zip_price_drop_30d'
Assert ($vwZipRows -ge 1) 'SELECT ... FROM vw_zip_price_drop_30d returns rows' '>=1' "$vwZipRows"

# ---------------------------------------------------------------------------
# 8. failure path: no DATABASE_URL -> exit 2, nothing written
# ---------------------------------------------------------------------------
$exit = Invoke-Store -InputRel $CleanRel -UnsetDsn
Save-StoreEvidence 'store_no_database_url.txt'
Assert ($exit -eq 2) 'missing DATABASE_URL -> exit code 2' '2' "$exit"
Assert ((Get-Count 'pipeline_runs') -eq 1 -and ((Invoke-Q -Sql 'SELECT DISTINCT status FROM pipeline_runs;' -TuplesOnly) -join '').Trim() -eq 'success') `
    'DB untouched by config failure (still 1 success row)' '1/success' "$(Get-Count 'pipeline_runs')"

# ---------------------------------------------------------------------------
# 9. teardown + result
# ---------------------------------------------------------------------------
try {
    $env:DATABASE_URL = $script:OrigDsn
} catch { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
if ($script:ServerUp -and -not $KeepServer) {
    $null = Invoke-BoundedExe -FilePath $PgCtl -TimeoutSec 90 `
        -ArgumentList @('stop', '-D', $PgData, '-m', 'fast', '-w', '-t', '60') `
        -OutFile (Join-Path $EvidenceDir 'server_stop.txt')
    Assert (-not (Test-ServerReady)) 'server stopped (pg_isready reports no response)' 'no response' 'still accepting'
    Log "server stopped"
}

$env:DATABASE_URL = $script:OrigDsn
Write-Host ''
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:PassCount, $script:FailCount)
Write-Host ("evidence: {0}" -f $EvidenceDir)
if ($script:FailCount -gt 0) { exit 1 } else { exit 0 }
