# GIT_INDEX_FILE Safety

## The Hazard

`GIT_INDEX_FILE` is an environment variable that redirects git to use an alternative
index file instead of `.git/index`. It is set by git worktree operations and some git
subcommands as part of their internal plumbing.

**In a multi-agent environment (like this repo), this variable is a shared hazard.**

If Process A sets `GIT_INDEX_FILE=/some/alternate/index` and does not clear it,
any concurrent Process B that inherits the environment will have ALL git commands
silently redirected to that alternate index. This means:

- `git add` stages files into the wrong index
- `git rm --cached` unstages from the wrong index
- `git commit` commits whatever is staged in the alternate index — potentially
  an empty commit, a corrupted partial commit, or another agent's staged work

**This has caused repo-level data loss in this repository multiple times.**

## The Rule

**ALWAYS `unset GIT_INDEX_FILE` (bash) or `Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue` (PowerShell)
as the FIRST line before any git operation in any script.**

This must come before `git add`, `git rm`, `git commit`, `git status`, or any other
git command that touches the index.

## Root Cause

Agents in this system operate concurrently in the same working tree. Environment
variables set by one agent's git worktree plumbing can bleed into another agent's
shell session if they share a terminal or process hierarchy. The `GIT_INDEX_FILE`
variable is particularly dangerous because git uses it silently — there is no
warning when it is set to a non-default path.

## Pattern: Safe Git Scripts

**PowerShell:**
```powershell
# SAFETY: Clear GIT_INDEX_FILE before ANY git operation.
# See docs/git-index-safety.md
Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue

git add ...
git commit ...
```

**Bash:**
```bash
# SAFETY: Clear GIT_INDEX_FILE before ANY git operation.
# See docs/git-index-safety.md
unset GIT_INDEX_FILE 2>/dev/null || true

git add ...
git commit ...
```

> **Note:** Scripts that use `git mv` for atomic file operations (such as `tasks/claim.ps1`
> and `tasks/claim.sh`) do not need to clear `GIT_INDEX_FILE` because `git mv` operates
> atomically on the index without exposing intermediate staged state. This pattern applies
> to scripts that use `git add` or `git rm --cached` directly.

## Verification Checklist

When reviewing any script that runs git commands:

- [ ] Does the script clear `GIT_INDEX_FILE` before the first git operation?
- [ ] Is the clear unconditional? PowerShell: `Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue` (not `if` guarded). Bash: `unset GIT_INDEX_FILE`.
- [ ] Is the clear the FIRST git-related line in the script, not buried after git calls?

## Historical Incidents

This hazard was first identified in task 10-314 (worktree cleanup) and flagged again
in PR #126 code review. Despite multiple acknowledgments, the fix was either not
applied or was placed incorrectly (after the git operations it was meant to protect).
Task 10-429 made the fix permanent and added this documentation.
