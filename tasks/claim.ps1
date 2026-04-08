<#
.SYNOPSIS
    Claims a task from 2-queued/ by staging a baseline snapshot at 4-completed/
    and moving the working copy to 3-in-progress/.

.DESCRIPTION
    1. [System.IO.File]::Move  task from 2-queued/ → 3-in-progress/  (atomic claim lock)
       Uses the Win32 MoveFile API, which is atomic for same-volume NTFS moves.
       Throws if another Worker already claimed the file.
    2. cp  3-in-progress/ → 4-completed/YYYY-MM-DD/  (baseline copy)
    3. git rm --cached tasks/2-queued/<file>          (remove old index entry)
    4. git add tasks/4-completed/YYYY-MM-DD/<file>    (stage baseline)

    If any post-claim step fails, the file is moved back to 2-queued/ automatically.

    When the task runner finishes and moves the file back to 4-completed/,
    `git diff` shows only the additions (Findings, Completion sections).

.PARAMETER TaskFile
    Filename of the task to claim (e.g., "10-040-review-loop-prompt.md").

.PARAMETER DryRun
    When set, prints what would be done without making any changes.

.EXAMPLE
    .\tasks\claim.ps1 10-040-review-loop-prompt.md

.EXAMPLE
    .\tasks\claim.ps1 10-040-review-loop-prompt.md -DryRun
#>
param(
    [Parameter(Mandatory)]
    [string]$TaskFile,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Validate TaskFile is a plain filename (no directory components)
if ($TaskFile -match '[/\\]' -or $TaskFile -match '\.\.') {
    Write-Error "TaskFile must be a plain filename, not a path: $TaskFile"
    exit 1
}

$repoRoot = Split-Path $PSScriptRoot -Parent
$queuedPath = Join-Path $repoRoot "tasks/2-queued/$TaskFile"
$date = Get-Date -Format 'yyyy-MM-dd'
$completedDir = Join-Path $repoRoot "tasks/4-completed/$date"
$completedPath = Join-Path $completedDir $TaskFile
$inProgressPath = Join-Path $repoRoot "tasks/3-in-progress/$TaskFile"

if ($DryRun) {
    # Existence check inside dry-run so the preview accurately reflects claimability
    if (-not (Test-Path $queuedPath)) {
        Write-Error "Task not found: $queuedPath"
        exit 1
    }
    Write-Host "[DRY RUN] Would: create directory tasks/4-completed/$date (if missing)"
    Write-Host "[DRY RUN] Would: [System.IO.File]::Move tasks/2-queued/$TaskFile -> tasks/3-in-progress/$TaskFile  (atomic claim)"
    Write-Host "[DRY RUN] Would: Copy-Item tasks/3-in-progress/$TaskFile -> tasks/4-completed/$date/$TaskFile  (baseline)"
    Write-Host "[DRY RUN] Would: git rm --cached tasks/2-queued/$TaskFile  (remove old index entry; skipped if untracked)"
    Write-Host "[DRY RUN] Would: git add tasks/4-completed/$date/$TaskFile  (stage baseline)"
    Write-Host ""
    Write-Host "[DRY RUN] No changes were made."
    return
}

# Create completed date directory if needed
if (-not (Test-Path $completedDir)) {
    New-Item -ItemType Directory -Path $completedDir -Force | Out-Null
}

# Step 1: Atomic claim — [System.IO.File]::Move maps to Win32 MoveFile, which is
# atomic for same-volume NTFS moves. Throws if the file is already gone (claimed by
# another Worker) or cannot be moved for any other reason.
try {
    [System.IO.File]::Move($queuedPath, $inProgressPath)
} catch {
    if (-not (Test-Path $queuedPath)) {
        Write-Error "Task already claimed by another Worker: $TaskFile"
    } else {
        Write-Error "Could not claim task: $_"
    }
    exit 1
}

# Steps 2-4: Post-claim work. On any failure, restore the file to the queue.
$claimed = $true
try {
    # Step 2: Baseline copy to completed/DATE/ for git index snapshot
    Copy-Item $inProgressPath $completedPath

    # Step 3 & 4: Git staging
    Push-Location $repoRoot
    try {
        # Remove old queued entry from the git index (may not be tracked — that's fine)
        git rm --cached "tasks/2-queued/$TaskFile" 2>$null
        if ($LASTEXITCODE -ne 0) {
            # Not tracked — that's acceptable, continue
        }

        # Stage the baseline copy
        git add "tasks/4-completed/$date/$TaskFile"
        if ($LASTEXITCODE -ne 0) {
            throw "git add failed with exit code $LASTEXITCODE"
        }

        # Safety: clear GIT_INDEX_FILE if set (15-300 removal — see 10-314)
        if ($env:GIT_INDEX_FILE) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }

        # Step 5: Targeted commit — only include the specific claim paths.
        # Prevents staging contamination regardless of shared index state.
        git commit -m "pipeline: claim $TaskFile" -- "tasks/2-queued/$TaskFile" "tasks/4-completed/$date/$TaskFile"
        if ($LASTEXITCODE -ne 0) {
            throw "git commit failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    $claimed = $false  # All steps succeeded — no rollback needed
} catch {
    if ($claimed) {
        # Restore file to queue so the task isn't lost in limbo
        try {
            Move-Item $inProgressPath $queuedPath -ErrorAction SilentlyContinue
        } catch {}
        Write-Error "Claim failed mid-flight — task restored to queue. Reason: $_"
        exit 1
    }
    throw
}

Write-Host "Claimed: $TaskFile"
Write-Host "  Baseline committed at: tasks/4-completed/$date/$TaskFile"
Write-Host "  Working copy at:       tasks/3-in-progress/$TaskFile"
Write-Host ""
Write-Host "After task runner finishes, move file to tasks/4-completed/$date/"
Write-Host "Then 'git diff' shows what changed."
