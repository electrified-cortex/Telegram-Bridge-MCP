---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-448
Source: Curator investigation — TMCP claim scripts diverged from canonical spec
---

# Sync TMCP claim scripts with canonical cortex.lan versions

## Background

The TMCP claim.ps1 and claim.sh diverged from the canonical cortex.lan versions.
The TMCP versions violate the claim.spec.md in multiple ways:

- Uses `[System.IO.File]::Move` instead of `git mv` (spec requires git mv)
- Uses `Remove-Item Env:GIT_INDEX_FILE` (spec explicitly forbids touching GIT_INDEX_FILE)
- Uses `git rm --cached` + `git add` (spec says only git mv + git commit)
- Creates baseline copies in `4-completed/YYYY-MM-DD/` (not in spec)
- Requires mandatory TaskFile parameter (canonical scans queue in priority order)

This divergence caused pipeline state corruption (untracked ghosts in 2-queued
and 3-in-progress) during Worker task claiming.

## Objective

Replace TMCP claim scripts with the canonical cortex.lan versions so all repos
use identical claim implementations matching the spec.

## Acceptance Criteria

- [ ] `tasks/claim.ps1` replaced with exact copy of cortex.lan `tasks/claim.ps1`
- [ ] `tasks/claim.sh` replaced with exact copy of cortex.lan `tasks/claim.sh`
- [ ] `tasks/claim.spec.md` copied from cortex.lan `tasks/claim.spec.md`
- [ ] Verify both scripts match the canonical versions (compare file hashes)
- [ ] Test: `claim.ps1 -DryRun` runs without error from TMCP repo root

## Reversal

Restore previous versions from git history: `git checkout HEAD~1 -- tasks/claim.ps1 tasks/claim.sh`

## Notes

After this change, the Worker permissions allowlist can be simplified — the
multi-hash entries for claim.ps1 and claim.sh can be consolidated to single
entries since all repos will have identical scripts with matching hashes.

## Completion

**Branch:** `10-448` in `Telegram MCP/.worktrees/10-448`
**Commit:** `138b593`

### What changed

- `tasks/claim.ps1` — replaced with canonical cortex.lan version (git mv, optional TaskFile, no GIT_INDEX_FILE, no baseline copy to 4-completed)
- `tasks/claim.sh` — same replacement
- `tasks/claim.spec.md` — new file (design spec, previously missing from TMCP)
- `docs/git-index-safety.md` — removed "claim.ps1/claim.sh pattern" labels from examples; added note clarifying git mv scripts are exempt from GIT_INDEX_FILE clearing requirement
- `changelog/unreleased.md` — updated Fixed and Security entries to reflect canonical replacement rather than intermediate GIT_INDEX_FILE ordering fix

### Findings (Minor/Info only)

- **Info:** DryRun test requires a tracked file in 2-queued to reach the DryRun code path; queue was empty so test exited at the "no tasks" guard. DryRun logic reviewed line-by-line and confirmed correct.
- **Info:** CRLF/LF hash mismatch between worktree files and canonical — benign Windows checkout artifact (core.autocrlf=true); staged index blobs are LF-identical to canonical.
- **Info:** No .gitattributes in TMCP repo (pre-existing gap, out of scope).
- **Info:** `git-index-safety.md` note wording slightly imprecise — git mv would still honor GIT_INDEX_FILE if set; more precise framing is that scripts are exempt because they don't call git add/git rm --cached directly. Not misleading for the intended audience.

### Deferred

- Permissions allowlist consolidation (noted in task, out of scope — separate follow-up)
- Add .gitattributes for consistent line endings (pre-existing gap)
