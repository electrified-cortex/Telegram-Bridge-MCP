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
