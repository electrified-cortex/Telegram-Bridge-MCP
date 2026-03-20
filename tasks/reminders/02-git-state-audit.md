# Git State Audit

**Frequency:** Every 10 min | **Scope:** Governor only

## Procedure

1. Run `git status --short`.
2. Verify current branch matches expected (currently `master`).
3. Check for:
   - Uncommitted changes — investigate origin.
   - Untracked files — determine if they should be committed or gitignored.
   - Divergence from remote — `git log --oneline @{u}..HEAD` and `git log --oneline HEAD..@{u}`.
4. If uncommitted work belongs to a worker, DM them to commit or explain.
5. Never assume the workspace is clean.
