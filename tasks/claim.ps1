<#
.SYNOPSIS
    Claims a task from 2-queued/ by staging a baseline snapshot at 4-completed/
    and moving the working copy to 3-in-progress/.

.DESCRIPTION
    1. git mv  task from 2-queued/ → 4-completed/YYYY-MM-DD/  (stages baseline)
    2. Move-Item  from 4-completed/YYYY-MM-DD/ → 3-in-progress/  (working copy)

    When the task runner finishes and moves the file back to 4-completed/,
    `git diff` shows only the additions (Findings, Completion sections).

.PARAMETER TaskFile
    Filename of the task to claim (e.g., "10-040-review-loop-prompt.md").

.EXAMPLE
    .\tasks\claim.ps1 10-040-review-loop-prompt.md
#>
param(
    [Parameter(Mandatory)]
    [string]$TaskFile
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$queuedPath = Join-Path $repoRoot "tasks/2-queued/$TaskFile"
$date = Get-Date -Format 'yyyy-MM-dd'
$completedDir = Join-Path $repoRoot "tasks/4-completed/$date"
$completedPath = Join-Path $completedDir $TaskFile
$inProgressPath = Join-Path $repoRoot "tasks/3-in-progress/$TaskFile"

if (-not (Test-Path $queuedPath)) {
    Write-Error "Task not found: $queuedPath"
    return
}

# Create completed date directory if needed
if (-not (Test-Path $completedDir)) {
    New-Item -ItemType Directory -Path $completedDir -Force | Out-Null
}

# Step 1: git mv to completed (stages the baseline snapshot)
git mv $queuedPath $completedPath
if ($LASTEXITCODE -ne 0) { Write-Error "git mv failed"; return }

# Step 2: Move working copy to in-progress
Move-Item $completedPath $inProgressPath

Write-Host "Claimed: $TaskFile"
Write-Host "  Baseline staged at: tasks/4-completed/$date/$TaskFile"
Write-Host "  Working copy at:    tasks/3-in-progress/$TaskFile"
Write-Host ""
Write-Host "After task runner finishes, move file to tasks/4-completed/$date/"
Write-Host "Then 'git diff' shows what changed."
