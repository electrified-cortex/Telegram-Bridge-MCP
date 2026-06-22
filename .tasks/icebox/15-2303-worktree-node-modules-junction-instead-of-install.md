---
id: "15-2303"
title: "worktree.sh: junction main node_modules into worktrees instead of pnpm install"
type: task
priority: 15
status: draft
created: 2026-06-12
repo: Telegram-Bridge-MCP
delegation: worker
---

# worktree.sh: junction main node_modules into worktrees instead of pnpm install

## Background

Foreman escalation 2026-06-12 (recurring DLL lock). After tasks 20-1903 and 20-2302,
both worktree directories are stuck on disk because pnpm installs sharp
(@img/sharp-win32-x64) whose native DLLs get loaded into a Windows process and held open.
Windows refuses to delete locked files. Git is clean; this is disk-only, but it accumulates.

Root cause: `(cd "$WORKTREE" && pnpm install)` in CUSTOMIZE B runs a fresh install per
worktree, causing the sharp DLLs to be loaded fresh in each worker's node process.

## Goal

Replace `pnpm install` in the worktree with a **junction to the main working tree's
`node_modules`**. Workers share the main tree's already-installed dependencies:
- No per-worktree DLL loading
- No locked DLLs on cleanup
- Faster worktree provisioning (no install step)

## Implementation

In `worktree.sh` CUSTOMIZE B, replace:
```bash
(cd "$WORKTREE" && pnpm install)
```
With:
```bash
# Junction main node_modules into worktree (avoids per-worker DLL loading on Windows)
REPO_ROOT="$(git rev-parse --show-toplevel)"
case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
        MSYS_NO_PATHCONV=1 cmd /c mklink /J \
            "$(cygpath -w "${WORKTREE}/node_modules")" \
            "$(cygpath -w "${REPO_ROOT}/node_modules")" >/dev/null \
            || echo "worktree.sh: WARN — node_modules junction failed" >&2
        ;;
    *)
        ln -sf "${REPO_ROOT}/node_modules" "${WORKTREE}/node_modules"
        ;;
esac
```

Also add `node_modules` to `.git/info/exclude` for worktrees (or verify it's already there
via a gitignore rule).

## Trade-off

Workers that need to add/change npm dependencies cannot do so with this approach — they'd
be modifying the shared node_modules. For dependency-changing tasks, the foreman should
revert to `pnpm install` for that specific worktree.

For the vast majority of feature/bug tasks (no new deps), this is safe and faster.

## Acceptance criteria

- New worktrees get a node_modules junction instead of a fresh install
- Cleanup after worker completion: junction deleted cleanly (no DLL lock)
- Existing pnpm install path documented as the fallback for dependency-changing tasks
- Windows and Linux paths both handled
