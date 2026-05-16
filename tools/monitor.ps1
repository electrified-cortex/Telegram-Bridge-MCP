#!/usr/bin/env pwsh
# monitor.ps1 — watch a TMCP activity file for changes; emit kick / heartbeat / timeout.
#
# Delegates to the file-watching skill (../skills/file-watching/watch.ps1) when available.
# Falls back to an inline FileSystemWatcher loop if the skill script is not present.
#
# Usage: monitor.ps1 <activity_file_path> [-Heartbeat <seconds>] [-Timeout <seconds>] [-Prefix <string>] [-Help]
#
# Parameters:
#   activity_file_path   Path to the activity file (from action(type: "activity/file/create")).
#   -Heartbeat <s>       Emit a `heartbeat` line every <s> idle seconds. Default: off (0 = disabled).
#   -Timeout <s>         Exit after <s> consecutive idle seconds with no kick. Default: never (0 = disabled).
#   -Prefix <string>     Insert "<prefix>: " before each token. Default: empty.
#   -Help                Print usage and exit.
#
# Output:
#   kick          — activity file mtime changed; call dequeue().
#   heartbeat     — no change in the last -Heartbeat seconds (monitor is alive).
#   timeout       — -Timeout elapsed with no kick; exits with code 0.

param(
    [Parameter(Position = 0)]
    [string]$ActivityFile = "",

    [int]$Heartbeat = 0,
    [int]$Timeout   = 0,
    [string]$Prefix = "",
    [switch]$Help
)

$usage = @'
Usage: monitor.ps1 <activity_file_path> [-Heartbeat <seconds>] [-Timeout <seconds>] [-Prefix <string>] [-Help]

Watches a TMCP activity file for mtime changes and emits one kick line per change.

  <activity_file_path>   Path returned by action(type: "activity/file/create").
  -Heartbeat <s>         Emit `heartbeat` every <s> idle seconds (monitor liveness signal).
  -Timeout <s>           Exit with `timeout` after <s> consecutive idle seconds. Default: never.
  -Prefix <string>       Insert "<prefix>: " before each token.
  -Help                  Print this help and exit.

Output lines:
  kick        mtime changed — call dequeue()
  heartbeat   monitor is alive (emitted every -Heartbeat seconds when idle)
  timeout     idle limit reached — exits 0
'@

if ($Help) {
    Write-Output $usage
    exit 0
}

if (-not $ActivityFile) {
    Write-Error "monitor.ps1: activity_file_path is required"
    Write-Output $usage
    exit 1
}

if ($Heartbeat -lt 0) {
    Write-Error "monitor.ps1: -Heartbeat must be a non-negative integer"
    exit 1
}

if ($Timeout -lt 0) {
    Write-Error "monitor.ps1: -Timeout must be a non-negative integer"
    exit 1
}

# Resolve to absolute path so GetDirectoryName/GetFileName work reliably.
$fullPath = [System.IO.Path]::GetFullPath($ActivityFile)

# ── Delegate to skill ─────────────────────────────────────────────────────────
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchScript = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '../skills/file-watching/watch.ps1'))

if (Test-Path -LiteralPath $watchScript) {
    $watchArgs = @($fullPath, '-Timeout', $Timeout, '-Heartbeat', $Heartbeat, '-Debounce', 0)
    if ($Prefix) { $watchArgs += @('-Prefix', $Prefix) }
    & $watchScript @watchArgs | ForEach-Object {
        # Strip ISO8601 timestamp (first word), then map changed → kick.
        $token = ($_ -split ' ', 2)[1]
        if ([string]::IsNullOrEmpty($token)) { return }
        if ($token -match '^(.+: )changed$') { "$($Matches[1])kick" }
        elseif ($token -eq 'changed') { 'kick' }
        else { $token }
    }
    exit $LASTEXITCODE
}

# ── Inline fallback ───────────────────────────────────────────────────────────
# Used only when skills/file-watching/watch.ps1 is not present at the expected path.

function Write-Token {
    param([string]$Token)
    if ($Prefix) {
        Write-Output "${Prefix}: $Token"
    } else {
        Write-Output $Token
    }
}

function Get-MTime {
    param([string]$Path)
    try {
        return (Get-Item $Path -ErrorAction Stop).LastWriteTimeUtc.ToFileTimeUtc()
    }
    catch {
        return 0
    }
}

$fileDir  = [System.IO.Path]::GetDirectoryName($fullPath)
$fileName = [System.IO.Path]::GetFileName($fullPath)

# Establish baseline so startup does not produce a spurious kick.
$lastMTime = 0
if (Test-Path $fullPath) {
    $lastMTime = Get-MTime $fullPath
}

$lastEventTime     = [DateTimeOffset]::UtcNow
$lastHeartbeatTime = $lastEventTime

while ($true) {
    $now = [DateTimeOffset]::UtcNow

    # Mtime check — handles races on watcher startup and detects pre-existing changes.
    if (Test-Path $fullPath) {
        $currentMTime = Get-MTime $fullPath
        if ($currentMTime -ne $lastMTime) {
            Write-Token "kick"
            $lastMTime         = $currentMTime
            $lastEventTime     = $now
            $lastHeartbeatTime = $now
            continue
        }
    }

    # Timeout check.
    if ($Timeout -gt 0) {
        $idleSecs = ($now - $lastEventTime).TotalSeconds
        if ($idleSecs -ge $Timeout) {
            Write-Token "timeout"
            exit 0
        }
    }

    # Heartbeat check (emit if overdue, reset timer).
    if ($Heartbeat -gt 0) {
        $sinceBeat = ($now - $lastHeartbeatTime).TotalSeconds
        if ($sinceBeat -ge $Heartbeat) {
            Write-Token "heartbeat"
            $lastHeartbeatTime = [DateTimeOffset]::UtcNow
        }
    }

    # Calculate maximum wait (ms) for this iteration.
    $waitMs = 30000
    if ($Timeout -gt 0) {
        $idleSecs  = ([DateTimeOffset]::UtcNow - $lastEventTime).TotalSeconds
        $remaining = [int](($Timeout - $idleSecs) * 1000)
        if ($remaining -lt 100) { $remaining = 100 }
        if ($remaining -lt $waitMs) { $waitMs = $remaining }
    }
    if ($Heartbeat -gt 0) {
        $sinceBeat     = ([DateTimeOffset]::UtcNow - $lastHeartbeatTime).TotalSeconds
        $remainingBeat = [int](($Heartbeat - $sinceBeat) * 1000)
        if ($remainingBeat -lt 100) { $remainingBeat = 100 }
        if ($remainingBeat -lt $waitMs) { $waitMs = $remainingBeat }
    }

    # Block using FileSystemWatcher (NotifyFilter = LastWriteTime).
    if (Test-Path $fullPath) {
        $watcher = [System.IO.FileSystemWatcher]::new($fileDir, $fileName)
        $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWriteTime
        $watcher.EnableRaisingEvents = $true
        try {
            $null = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Changed, $waitMs)
        }
        finally {
            $watcher.Dispose()
        }
    }
    else {
        Start-Sleep -Milliseconds $waitMs
    }
}
