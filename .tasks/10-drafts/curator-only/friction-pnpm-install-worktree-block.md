---
id: friction-pnpm-install-worktree-block
title: Friction — Workers blocked on pnpm install in every new TMCP worktree
priority: 10
status: draft
type: friction
delegation: curator
---

# Friction: pnpm install required in every new TMCP worktree

## Observed pattern

Every time a Worker creates a new worktree in Telegram MCP, `node_modules` is absent and `pnpm test` fails immediately. Workers cannot run `pnpm install` themselves (permission boundary). Overseer must intervene to unblock — adding round-trip latency before any work can begin.

Occurred twice this session: 10-0823 worktree, then 20-0822 worktree.

## Root cause

pnpm worktrees do not share `node_modules` by default. Each worktree is an isolated directory with no `node_modules/`. The lockfile is frozen (`--frozen-lockfile`), so install must be run explicitly.

## Options

1. **Pre-install hook**: Add a worktree post-create step in the task claim script (`claim.sh`) that runs `pnpm install --frozen-lockfile` automatically.
2. **pnpm shared store**: Configure `node-linker=hoisted` or a global store so worktrees share packages without re-installing.
3. **Overseer worktree setup step**: Document that Overseer runs `pnpm install` immediately after any new TMCP worktree is created, before handing off to Workers.
4. **symlink node_modules**: Each worktree symlinks `../node_modules` from the main worktree.

## Impact

Adds one Worker→Overseer→Worker round-trip per new task. At current velocity (2 new worktrees this session), costs ~5–10 min of idle Worker time per task.

## Needs Curator review
