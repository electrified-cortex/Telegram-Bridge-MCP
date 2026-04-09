---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-429
Source: Operator (API review session — safety critical)
---

# 10-429: GIT_INDEX_FILE Safety Fix + Documentation

## Objective

Fix the GIT_INDEX_FILE ordering bug in `tasks/claim.ps1` and `tasks/claim.sh`, and
create a safety spec document in the TMCP repo that permanently records this hazard.
This is a recurring issue that has caused repo-level data loss multiple times. The
fix must be thorough and the documentation must be prominent enough to prevent
future regressions.

## Context

Copilot PR reviewer flagged (PR #126) that `$env:GIT_INDEX_FILE` is cleared AFTER
`git rm --cached` and `git add` in the claim scripts. If this variable is set by
a concurrent process (common in a multi-agent environment), those git commands
operate on the wrong index — leading to corrupted staging, lost commits, or
wiped-out repos.

This issue has been found and acknowledged multiple times but never permanently
resolved. The operator considers this safety-critical.

## Acceptance Criteria

- [ ] `claim.ps1`: `$env:GIT_INDEX_FILE = ""` moved BEFORE any `git rm`, `git add`, or `git commit` calls
- [ ] `claim.sh`: `unset GIT_INDEX_FILE` moved BEFORE any git calls
- [ ] Both scripts have a comment block explaining WHY this must be first
- [ ] `docs/git-index-safety.md` created in TMCP repo documenting:
  - The hazard (what happens when GIT_INDEX_FILE is set by another process)
  - The root cause (shared env vars in concurrent git operations)
  - The rule: ALWAYS clear GIT_INDEX_FILE before any git operation in scripts
  - Historical incidents (repo-level data loss observed multiple times)
- [ ] Safety doc linked from TMCP's contributing guide or README
- [ ] All tests pass after changes
- [ ] PR #126 non-outdated comment on `claim.ps1` line 114 addressed

## Notes

- This is a **merge blocker** for PR #126
- Priority: highest — safety critical, operator-escalated
- The fix itself is trivial (move one line); the documentation is the real deliverable

## Completion

**Branch:** `10-429`  
**Commit:** `ab84d85`  
**Files changed:** 4 files, 88 insertions, 6 deletions

**What changed:**
- `tasks/claim.ps1`: Moved `Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue` to FIRST position in git operations block (before `git rm --cached`); removed old conditional guard that was after `git add`; added strong safety comment referencing `docs/git-index-safety.md`
- `tasks/claim.sh`: Strengthened comment to match severity (code was already correct — clear was before git ops)
- `docs/git-index-safety.md`: New file — full hazard documentation, rule statement, root cause, PowerShell and bash patterns with verification checklist, historical incidents
- `README.md`: Link to safety doc added in Development section

**Code Review:** `minor_only` — all findings resolved
- [RESOLVED MAJOR] Doc said "unconditional" but PS example was conditional `if` guard — fixed to `Remove-Item` (unconditional, true unset)
- [RESOLVED MINOR] Set-to-empty vs true unset — fixed: `Remove-Item` removes var from environment entirely
- [RESOLVED MINOR] "The Rule" prose section still showed `$env:GIT_INDEX_FILE = ""` — fixed inline

**Build:** Tests 2129/2129 PASS

**Status:** Ready for Overseer merge to dev.
