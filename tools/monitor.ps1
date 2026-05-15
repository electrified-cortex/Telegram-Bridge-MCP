#!/usr/bin/env pwsh
# monitor.ps1 — watch a TMCP activity file for changes; emit kick / heartbeat / timeout.
#
# Detection:
#   [System.IO.FileSystemWatcher] with NotifyFilter = LastWriteTime.
#   Built-in on all .NET platforms (Windows, Linux, macOS). On Windows this
#   uses ReadDirectoryChangesW (~100 ms event latency); on Linux it uses
#   inotify; on macOS it uses FSEvents. No external dependencies required.
#
# Usage: monitor.ps1 <activity_file_path> [-Heartbeat <seconds>] [-Timeout <seconds>]
#
# Parameters:
#   activity_file_path   Absolute path to the activity file (from action(type: "activity/file/create")).
#   -Heartbeat <s>       Emit a `heartbeat` line every <s> idle seconds. Default: off (0 = disabled).
#   -Timeout <s>         Exit after <s> consecutive idle seconds with no kick. Default: never (0 = disabled).
#   -Help                Print usage and exit.
#
# Output:
#   kick          — activity file mtime changed; call dequeue().
#   heartbeat     — no change in the last -Heartbeat seconds (monitor is alive).
#   timeout       — -Timeout elapsed with no kick; exits with code 0.
#
# Exit code: 0 on timeout or normal termination; 1 on argument error.

param(
    [Parameter(Position = 0)]
    [string]$ActivityFile = "",

    [int]$Heartbeat = 0,
    [int]$Timeout   = 0,
    [switch]$Help
)

$usage = @'
Usage: monitor.ps1 <activity_file_path> [-Heartbeat <seconds>] [-Timeout <seconds>] [-Help]

Watches a TMCP activity file for mtime changes and emits one kick line per change.

  <activity_file_path>   Path returned by action(type: "activity/file/create").
  -Heartbeat <s>         Emit `heartbeat` every <s> idle seconds (monitor liveness signal).
  -Timeout <s>           Exit with `timeout` after <s> consecutive idle seconds. Default: never.
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

function Get-MTime {
    param([string]$Path)
    try {
        return (Get-Item $Path -ErrorAction Stop).LastWriteTimeUtc.ToFileTimeUtc()
    }
    catch {
        return 0
    }
}

# Resolve to absolute path so GetDirectoryName/GetFileName work reliably.
$fullPath = [System.IO.Path]::GetFullPath($ActivityFile)
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
            Write-Output "kick"
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
            Write-Output "timeout"
            exit 0
        }
    }

    # Heartbeat check (emit if overdue, reset timer).
    if ($Heartbeat -gt 0) {
        $sinceBeat = ($now - $lastHeartbeatTime).TotalSeconds
        if ($sinceBeat -ge $Heartbeat) {
            Write-Output "heartbeat"
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
