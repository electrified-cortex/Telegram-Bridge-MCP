#!/usr/bin/env pwsh
# telegram-loop-guard.ps1 — VS Code Copilot Chat Stop hook
#
# Prevents agent exit when the current conversation has an active Telegram
# session stored in VS Code session memory.
#
# Fully deterministic — uses the sessionId from hook input to locate the
# exact session memory directory. No heuristics, no HTTP probes.
#
# Detection: sessionId → base64 → lookup telegram-session.md in workspace
# storage memory directory. If the file exists and has content → block.
#
# Install: place companion JSON in .github/hooks/telegram-loop-guard.json

$ErrorActionPreference = 'SilentlyContinue'

# --- Read hook input from stdin ---
$raw = ''
try { $raw = [Console]::In.ReadToEnd() } catch { exit 0 }
if (-not $raw -or -not $raw.Trim()) { exit 0 }

$hook = $null
try { $hook = $raw | ConvertFrom-Json } catch { exit 0 }
if (-not $hook) { exit 0 }

# VS Code sends snake_case keys despite docs showing camelCase
$eventName = if ($hook.hook_event_name) { $hook.hook_event_name } elseif ($hook.hookEventName) { $hook.hookEventName } else { '' }
$sessionId = if ($hook.session_id) { $hook.session_id } elseif ($hook.sessionId) { $hook.sessionId } else { '' }

# --- Only process Stop events — exit silently for all others ---
# Note: VS Code may pass hookEventName as empty for Stop events
if ($eventName -and $eventName -ne 'Stop') { exit 0 }

# --- Prevent infinite loop ---
if ($hook.stop_hook_active -eq $true) { exit 0 }

# --- Locate workspace storage directory ---
$appData = $env:APPDATA
if (-not $appData) { exit 0 }

$wsStorageRoot = Join-Path $appData "Code\User\workspaceStorage"
if (-not (Test-Path $wsStorageRoot)) { exit 0 }

# Use cwd from hook input as the workspace folder
$cwd = $hook.cwd
if (-not $cwd) { exit 0 }

# Convert to file URI format used in workspace.json
$normalized = $cwd -replace '\\', '/'
$normalized = $normalized -replace '^([A-Za-z]):', '$1%3A'
$wsUri = "file:///$normalized"

$wsDir = $null
foreach ($d in Get-ChildItem $wsStorageRoot -Directory) {
    $wj = Join-Path $d.FullName "workspace.json"
    if (Test-Path $wj) {
        try {
            $ws = Get-Content $wj -Raw | ConvertFrom-Json
            if ($ws.folder -ieq $wsUri) {
                $wsDir = $d.FullName
                break
            }
        } catch { continue }
    }
}
if (-not $wsDir) { exit 0 }

# --- Find session file ---
$sessionFile = $null
$memoriesRoot = Join-Path $wsDir "GitHub.copilot-chat\memory-tool\memories"

if ($sessionId) {
    # Preferred: use sessionId to find exact session memory directory
    $sessionDirName = [Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes($sessionId)
    )
    $sessionDirName = $sessionDirName.TrimEnd('=')

    $candidate = Join-Path $memoriesRoot "$sessionDirName\telegram-session.md"
    if (Test-Path $candidate) {
        $sessionFile = $candidate
    } else {
        # Try with padding
        $paddedName = [Convert]::ToBase64String(
            [System.Text.Encoding]::UTF8.GetBytes($sessionId)
        )
        $candidate = Join-Path $memoriesRoot "$paddedName\telegram-session.md"
        if (Test-Path $candidate) {
            $sessionFile = $candidate
        }
    }
} else {
    # Fallback: VS Code doesn't pass sessionId on Stop events
    # Scan ALL session memory directories for telegram-session.md
    if (Test-Path $memoriesRoot) {
        foreach ($memDir in Get-ChildItem $memoriesRoot -Directory) {
            $candidate = Join-Path $memDir.FullName "telegram-session.md"
            if (Test-Path $candidate) {
                $content = Get-Content $candidate -Raw
                if ($content -and $content.Trim().Length -gt 0) {
                    $sessionFile = $candidate
                    break
                }
            }
        }
    }
}

if (-not (Test-Path $sessionFile)) { exit 0 }

# --- Check file has content ---
$content = Get-Content $sessionFile -Raw
if (-not $content -or $content.Trim().Length -eq 0) { exit 0 }

# --- Active session detected — block the stop ---
$output = @{
    hookSpecificOutput = @{
        hookEventName = "Stop"
        decision      = "block"
        reason        = "Telegram session file found in your session memory (/memories/session/telegram-session.md). " +
                        "If you have an active Telegram session, resume the dequeue loop immediately. " +
                        "If you were NOT in a Telegram session or the bridge is unreachable, " +
                        "wipe the session file (write an empty string to it) and stop again."
    }
} | ConvertTo-Json -Depth 5 -Compress

Write-Output $output
exit 0
