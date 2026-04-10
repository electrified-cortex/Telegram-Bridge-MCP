<#
.SYNOPSIS
    Claims the next valid task from 2-queued/ by moving it to 3-in-progress/ via git mv.

.DESCRIPTION
    Scans tasks/2-queued/ in priority order (filename sort). For each candidate:
      1. Skips untracked files (not in git index) — warns and notifies Overseer.
      2. Skips dirty files (uncommitted working-tree modifications) — warns and notifies Overseer.
      3. git mv  tasks/2-queued/<file>  →  tasks/3-in-progress/<file>
         Atomic index + filesystem move. Skips if already claimed (race-safe).
      4. git commit  (targeted to claim paths only)

    git mv is atomic in the index — no intermediate staged state visible to
    other agents. Eliminates shared index contamination.

    On any failure after mv, the operation rolls back to 2-queued/.

.PARAMETER TaskFile
    Optional. Preferred task filename (e.g., "10-040-review-loop-prompt.md").
    If provided, this file is tried first. If invalid, scanning continues with
    remaining queue files in priority order.

.PARAMETER DryRun
    When set, prints what would be done without making any changes.

.EXAMPLE
    .\tasks\claim.ps1

.EXAMPLE
    .\tasks\claim.ps1 10-040-review-loop-prompt.md

.EXAMPLE
    .\tasks\claim.ps1 -DryRun
#>
param(
    [string]$TaskFile = "",

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Validate TaskFile if provided (must be a plain filename)
if ($TaskFile -and ($TaskFile -match '[/\\]' -or $TaskFile -match '\.\.')) {
    Write-Error "TaskFile must be a plain filename, not a path: $TaskFile"
    exit 1
}

$repoRoot = Split-Path $PSScriptRoot -Parent
$queueDir = "tasks/2-queued"

Push-Location $repoRoot
try {
    # Build candidate list: preferred file first (if specified), then remaining queue sorted by name
    $allQueued = Get-ChildItem -Path "$repoRoot/$queueDir/*.md" -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -ExpandProperty Name

    if ($TaskFile) {
        $candidates = @($TaskFile) + ($allQueued | Where-Object { $_ -ne $TaskFile })
    } else {
        $candidates = $allQueued
    }

    if (-not $candidates) {
        Write-Error "No tasks found in $queueDir"
        exit 1
    }

    $claimed = $null

    foreach ($candidate in $candidates) {
        $candidatePath = "$repoRoot/$queueDir/$candidate"

        if (-not (Test-Path $candidatePath)) {
            continue
        }

        # Gate 1: must be tracked in git index
        git ls-files --error-unmatch "$queueDir/$candidate" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "SKIP: $candidate — untracked file in queue. Notify Overseer."
            continue
        }

        # Gate 2: must be clean (no working-tree modifications)
        $dirty = git diff --name-only -- "$queueDir/$candidate" 2>$null
        if ($dirty) {
            Write-Warning "SKIP: $candidate — dirty (uncommitted modifications) in queue. Notify Overseer."
            continue
        }

        if ($DryRun) {
            Write-Host "[DRY RUN] Would: git mv $queueDir/$candidate -> tasks/3-in-progress/$candidate"
            Write-Host "[DRY RUN] Would: git commit -m `"pipeline: claim $candidate`""
            Write-Host ""
            Write-Host "[DRY RUN] No changes were made."
            return
        }

        # Attempt atomic claim
        git mv "$queueDir/$candidate" "tasks/3-in-progress/$candidate" 2>$null
        if ($LASTEXITCODE -ne 0) {
            # Race: another Worker claimed it between our checks and mv
            Write-Warning "SKIP: $candidate — claim race (file already taken)."
            continue
        }

        # Commit — targeted to claim paths only
        git commit -m "pipeline: claim $candidate" -- "$queueDir/$candidate" "tasks/3-in-progress/$candidate"
        if ($LASTEXITCODE -ne 0) {
            # Rollback: reverse the git mv
            git mv "tasks/3-in-progress/$candidate" "$queueDir/$candidate" 2>$null
            Write-Warning "SKIP: $candidate — commit failed, rolled back."
            continue
        }

        $claimed = $candidate
        break
    }

    if (-not $claimed) {
        Write-Error "No claimable tasks found in $queueDir"
        exit 1
    }

} finally {
    Pop-Location
}

Write-Host "Claimed: $claimed"
Write-Host "  Working copy at: tasks/3-in-progress/$claimed"
Write-Host ""
Write-Host "When done, git mv tasks/3-in-progress/$claimed tasks/4-completed/<date>/$claimed"
Write-Host "Then git commit and notify the Overseer."
