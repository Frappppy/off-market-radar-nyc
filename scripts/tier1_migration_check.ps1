#Requires -Version 5.1
<#
.SYNOPSIS
  Verifies the Tier 1 migration against a real PostgreSQL before it is applied
  to production (docs/apply_tier1_migration.md, docs/roadmap.md 1.1 / 1.2).

.DESCRIPTION
  Boots an ephemeral local PostgreSQL 18 (initdb -A trust, 127.0.0.1 only — no
  credentials anywhere) and runs scripts/tier1_migration_check.py against it.
  The Python driver creates and drops only its own `tier1_*` databases; the
  production branch is never contacted.

  Why: the backend validation gate could only INFER the consequences of the
  apply order, because no local psql existed. This executes them. The driver
  asserts apply order, idempotency, the is_active upgrade guard (the hazard that
  would break the next scheduled load), the H1 grant hazard and the runbook's
  fix for it, the stale-marking cold-start gate, vw_listing_history against the
  shipped LISTING_HISTORY_QUERY, and the 1.1 recency guard. See the .py header.

  Exit codes: 0 = every assertion passed (or graceful SKIP: prereq absent),
              1 = at least one assertion failed.

.INPUTS  none.
.OUTPUTS jobs/<RunId>/evidence/assertions.txt (full transcript + summary)

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tier1_migration_check.ps1
.EXAMPLE
  ... -KeepServer    # leave the cluster running for follow-up psql work
#>
[CmdletBinding()]
param(
    [string]$RunId = ("tier1-migration-" + (Get-Date -Format 'yyyyMMdd-HHmmss')),
    [switch]$KeepServer
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Prefix   = Join-Path $env:LOCALAPPDATA 'Temp\opencode\pglive'
$PgBin    = Join-Path $Prefix 'Library\bin'
$PgData   = Join-Path $Prefix 'pgdata'
$Port     = 55432
$Dsn      = "postgresql://postgres@127.0.0.1:$Port/postgres"
$Python   = Join-Path $RepoRoot '.venv\Scripts\python.exe'
if (-not [System.IO.File]::Exists($Python)) {
    # .venv may live one level up if the project tree moved into a subfolder.
    $Python = Join-Path (Split-Path -Parent $RepoRoot) '.venv\Scripts\python.exe'
}
$JobDir      = Join-Path $RepoRoot "jobs\$RunId"
$EvidenceDir = Join-Path $JobDir 'evidence'
$SummaryPath = Join-Path $EvidenceDir 'assertions.txt'

$Psql      = Join-Path $PgBin 'psql.exe'
$PgIsReady = Join-Path $PgBin 'pg_isready.exe'
$PgCtl     = Join-Path $PgBin 'pg_ctl.exe'
$InitDb    = Join-Path $PgBin 'initdb.exe'

$script:ServerUp = $false

# ---------------------------------------------------------------------------
# NOTE ON PATHS. This repo lives under a folder whose name contains square
# brackets ("Project 1 [The Off-Market ...]"). PowerShell's file-system cmdlets
# treat [ ] as wildcard metacharacters, so Test-Path / Remove-Item / Set-Content
# / Add-Content / Start-Process -FilePath all fail on those paths with
# "The specified wildcard character pattern is not valid". Every file operation
# below therefore goes through the .NET APIs (always literal), and every child
# process is launched via cmd.exe, so no repository path is ever interpreted as
# a wildcard.
# ---------------------------------------------------------------------------
function Write-Text([string]$Path, [string]$Text)  { [System.IO.File]::WriteAllText($Path, $Text) }
function Append-Text([string]$Path, [string]$Text) { [System.IO.File]::AppendAllText($Path, $Text) }
function Read-Text([string]$Path) {
    if ([System.IO.File]::Exists($Path)) { return [System.IO.File]::ReadAllText($Path) }
    return ''
}

function Quote-Arg([string]$Value) { '"' + $Value + '"' }

function Invoke-Bounded {
    # Runs a command line through cmd.exe with a hard timeout, capturing both
    # streams as text. cmd.exe is resolved from the environment, so $FileName
    # never contains brackets; paths inside $CommandLine are quoted and cmd does
    # not wildcard-expand, so bracketed directories survive intact.
    #
    # The command is wrapped as:  cmd /d /s /c "<command line>"
    # /S is required and not cosmetic. Without it, cmd applies its "if the first
    # character is a quote, strip it and also strip the LAST quote on the line"
    # rule whenever the line holds more than two quotes — exactly what a
    # `pg_ctl start -D "<dir>" -o "<opts>" -l "<log>"` line looks like. With /S
    # cmd strips only the outer pair, leaving every inner quote intact.
    param([string]$CommandLine, [int]$TimeoutSec = 60, [string]$WorkingDirectory = '', [switch]$NoCapture)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = '/d /s /c "' + $CommandLine + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = (-not $NoCapture)
    $psi.RedirectStandardError = (-not $NoCapture)
    $psi.CreateNoWindow = $true
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }
    $p = [System.Diagnostics.Process]::Start($psi)
    $outTask = $null
    $errTask = $null
    if (-not $NoCapture) {
        $outTask = $p.StandardOutput.ReadToEndAsync()
        $errTask = $p.StandardError.ReadToEndAsync()
    }
    $exited = $p.WaitForExit($TimeoutSec * 1000)
    if (-not $exited) {
        # pg_ctl can linger in exit under antivirus even after printing "server
        # started". The postmaster is daemonized, so killing the tool is safe.
        try { $p.Kill() } catch {}
        $null = $p.WaitForExit(10000)
        Log "did not exit within ${TimeoutSec}s -> killed: $CommandLine"
    }
    $code = -1
    if ($exited) { try { $code = [int]$p.ExitCode } catch { $code = -1 } }
    $text = ''
    if (-not $NoCapture) {
        # BOUNDED reads, deliberately. `pg_ctl start` daemonizes the postmaster,
        # which INHERITS the write end of these pipes and holds it for the life
        # of the server — so ReadToEndAsync never completes and `.Result` blocks
        # FOREVER (no timeout applies to it). Reading with a deadline is what
        # keeps a daemonizing child from hanging this script.
        if ($outTask.Wait(5000)) {
            $text += $outTask.Result
        } else {
            $text += "(stdout not captured within 5s: a child process still holds the pipe — expected when a command daemonizes)"
        }
        if ($errTask.Wait(2000)) { $text += $errTask.Result }
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $text }
}

function Log([string]$Message) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) }
function Skip-Check([string]$Reason) {
    Write-Host "SKIP: $Reason"
    # no evidence dir yet: write nothing, and do not claim unproven coverage
    exit 0
}

[void][System.IO.Directory]::CreateDirectory($EvidenceDir)
Write-Text $SummaryPath "tier1_migration_check  run_id=$RunId  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`n"

# ---------------------------------------------------------------------------
# 0. prerequisites -> graceful SKIP
# ---------------------------------------------------------------------------
if (-not [System.IO.File]::Exists($Python)) { Skip-Check "project venv not found: $Python" }
$missingPg = @('postgres.exe', 'pg_ctl.exe', 'psql.exe', 'initdb.exe', 'pg_isready.exe') |
    Where-Object { -not [System.IO.File]::Exists((Join-Path $PgBin $_)) }
if ($missingPg) {
    $conda = @(
        'C:\ProgramData\anaconda3\Scripts\conda.exe',
        (Join-Path $env:USERPROFILE 'miniconda3\Scripts\conda.exe'),
        (Join-Path $env:USERPROFILE 'miniforge3\Scripts\conda.exe'),
        (Join-Path $env:USERPROFILE 'anaconda3\Scripts\conda.exe')
    ) | Where-Object { [System.IO.File]::Exists($_) } | Select-Object -First 1
    if ($conda) {
        Log "installing PostgreSQL into $Prefix (conda) ..."
        $inst = Invoke-Bounded -TimeoutSec 1800 -CommandLine ((Quote-Arg $conda) + " create -y -p " + (Quote-Arg $Prefix) + " -c conda-forge postgresql=18 libpq")
        Write-Text (Join-Path $EvidenceDir 'conda_install.txt') $inst.Output
        $missingPg = @('postgres.exe', 'pg_ctl.exe', 'psql.exe', 'initdb.exe', 'pg_isready.exe') |
            Where-Object { -not [System.IO.File]::Exists((Join-Path $PgBin $_)) }
    }
    if ($missingPg) {
        Skip-Check "PostgreSQL absent ($($missingPg -join ', ')). Run: conda create -y -p `"$Prefix`" -c conda-forge postgresql=18 libpq"
    }
}
if (-not [System.IO.File]::Exists((Join-Path $Prefix 'Library\share\postgres.bki'))) {
    Skip-Check "cluster prefix is damaged (Library\share\postgres.bki missing); re-run scripts\live_db_check.ps1 to self-heal"
}

function Test-ServerReady {
    $r = Invoke-Bounded -TimeoutSec 15 -CommandLine ("`"$PgIsReady`" -h 127.0.0.1 -p $Port")
    return ($r.ExitCode -eq 0)
}

# ---------------------------------------------------------------------------
# 1. cluster: initdb if needed, then a bounded start
# ---------------------------------------------------------------------------
if (-not [System.IO.File]::Exists((Join-Path $PgData 'PG_VERSION'))) {
    Log "initdb $PgData"
    $r = Invoke-Bounded -TimeoutSec 300 -CommandLine ("`"$InitDb`" -D " + (Quote-Arg $PgData) + " -U postgres -A trust --encoding=UTF8")
    Write-Text (Join-Path $EvidenceDir 'initdb.txt') $r.Output
    if ($r.ExitCode -ne 0) { Skip-Check "initdb failed with exit $($r.ExitCode) (see evidence\initdb.txt)" }
}

if (-not (Test-ServerReady)) {
    # A postmaster can be alive yet stuck in a fork-crash loop, and pg_isready
    # then reports "no response". Stop whatever is there before starting.
    Log "server not ready -> pg_ctl stop (immediate), then bounded start"
    $r = Invoke-Bounded -TimeoutSec 45 -CommandLine ("`"$PgCtl`" stop -D " + (Quote-Arg $PgData) + " -m immediate -w -t 25")
    Write-Text (Join-Path $EvidenceDir 'server_stop_stale.txt') $r.Output
    $stalePid = Join-Path $PgData 'postmaster.pid'
    if ([System.IO.File]::Exists($stalePid)) { [System.IO.File]::Delete($stalePid) }  # pid of a dead postmaster only
    # No -w: readiness is polled below, and pg_ctl's exit can linger.
    # -NoCapture is REQUIRED here: this command daemonizes the postmaster, which
    # would inherit and hold the capture pipes open forever (see Invoke-Bounded).
    $startCmd = "`"$PgCtl`" start -D " + (Quote-Arg $PgData) + " -o `"-h 127.0.0.1 -p $Port`" -l " + (Quote-Arg (Join-Path $PgData 'pglive.log'))
    $r = Invoke-Bounded -TimeoutSec 45 -NoCapture -CommandLine $startCmd
    Write-Text (Join-Path $EvidenceDir 'server_start.txt') ("pg_ctl start exit=$($r.ExitCode) (output not captured on purpose: the postmaster inherits the pipe; the server log is $PgData\pglive.log)")
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-ServerReady) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
}
if (-not (Test-ServerReady)) {
    Write-Host "FAIL: PostgreSQL did not come up on 127.0.0.1:$Port (see evidence\server_start.txt)"
    Append-Text $SummaryPath 'FAIL  cluster did not accept connections'
    exit 1
}
$script:ServerUp = $true
Log "PostgreSQL ready on 127.0.0.1:$Port"

# ---------------------------------------------------------------------------
# 2. run the assertions
# ---------------------------------------------------------------------------
# Keep the driver path RELATIVE and set WorkingDirectory instead: the absolute
# repo path contains brackets, and relative args are unaffected.
$Driver = 'scripts\tier1_migration_check.py'
if (-not [System.IO.File]::Exists((Join-Path $RepoRoot $Driver))) { Skip-Check "driver not found: $Driver" }
$env:DATABASE_URL = $Dsn
$r = Invoke-Bounded -TimeoutSec 900 -WorkingDirectory $RepoRoot -CommandLine ((Quote-Arg $Python) + " $Driver")
$env:DATABASE_URL = ''
$driverExit = $r.ExitCode
$out = $r.Output

Write-Host $out
Append-Text $SummaryPath $out

# ---------------------------------------------------------------------------
# 3. summary
# ---------------------------------------------------------------------------
$passed = ([regex]::Matches("$out", '(?m)^\s+PASS\s')).Count
$failed = ([regex]::Matches("$out", '(?m)^\s+FAIL\s')).Count
Log "driver exit=$driverExit  passed=$passed  failed=$failed"
Append-Text $SummaryPath "driver exit=$driverExit  passed=$passed  failed=$failed`r`n"

if (-not $KeepServer -and $script:ServerUp) {
    Log "stopping the ephemeral cluster"
    $r = Invoke-Bounded -TimeoutSec 45 -CommandLine ("`"$PgCtl`" stop -D " + (Quote-Arg $PgData) + " -m fast -w -t 25")
    Write-Text (Join-Path $EvidenceDir 'server_stop.txt') $r.Output
}
if ($KeepServer) { Log "cluster left running on 127.0.0.1:$Port (-KeepServer)" }

Log "evidence: $EvidenceDir"
if ($driverExit -ne 0 -or $failed -gt 0) {
    Write-Host "RESULT: $passed passed, $failed failed"
    exit 1
}
Write-Host "RESULT: ALL CHECKS PASSED ($passed)"
exit 0
