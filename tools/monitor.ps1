#!/usr/bin/env pwsh
# monitor.ps1 — watch a TMCP activity file for mtime changes; emit a kick line on each change.
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

# Use FileSystemWatcher for event-driven detection on Windows; poll loop as fallback.
# We use a poll loop here for cross-platform consistency (Git-Bash, WSL, Linux pwsh).
# The poll interval is 1 second — same as monitor.sh.

function Get-MTime {
    param([string]$Path)
    try {
        return (Get-Item $Path -ErrorAction Stop).LastWriteTimeUtc.ToFileTimeUtc()
    }
    catch {
        return 0
    }
}

# Establish baseline so startup does not produce a spurious kick.
$lastMTime = 0
if (Test-Path $ActivityFile) {
    $lastMTime = Get-MTime $ActivityFile
}

$lastEventTime    = [DateTimeOffset]::UtcNow
$lastHeartbeatTime = $lastEventTime

while ($true) {
    $now = [DateTimeOffset]::UtcNow

    if (Test-Path $ActivityFile) {
        $currentMTime = Get-MTime $ActivityFile
        if ($currentMTime -ne $lastMTime) {
            Write-Output "kick"
            $lastMTime         = $currentMTime
            $lastEventTime     = $now
            $lastHeartbeatTime = $now
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

    # Heartbeat check.
    if ($Heartbeat -gt 0) {
        $idleSinceBeat = ($now - $lastHeartbeatTime).TotalSeconds
        if ($idleSinceBeat -ge $Heartbeat) {
            Write-Output "heartbeat"
            $lastHeartbeatTime = $now
        }
    }

    Start-Sleep -Seconds 1
}
