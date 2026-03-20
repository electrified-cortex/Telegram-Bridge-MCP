# Task #025 — PR #60 Review Exhaustion (Shutdown Guidance)

## Objective

Rebase `task/005-shutdown-restart-guidance` on latest `master`, verify all Copilot review fixes are intact, push, and resolve all review threads on PR #60.

## Context

- PR: #60 (`task/005-shutdown-restart-guidance` → `master`)
- Worktree: `.git/.wt/25-005-shutdown-restart-guidance` (detached HEAD at `1108b1a`)
- PR retargeted from `v4-multi-session` to `master`. Rebase onto `master` required.
- Prior session committed fixes and posted "Fixed" replies, but threads remain unresolved.

## Non-Outdated Review Issues (4 threads)

All have "Fixed" replies. Verify after rebase:

1. **Empty reason validation** (`notify_shutdown_warning.ts:32`) — `reason` allows empty/whitespace strings. Expected: `.string().trim().min(1).optional()`.
2. **Conflicting restart flow docs** (`docs/behavior.md:504`) — new shutdown guidance conflicts with earlier "Restart flow" section. Expected: callout distinguishing shutdown-triggered restart from crash restart.
3. **Shared guidance constant** (`shutdown.ts:68`) — duplicated guidance text between shutdown message and warning tool. Expected: `RESTART_GUIDANCE` imported from `src/restart-guidance.ts`.
4. **Malformed markdown table** (`docs/behavior.md:517`) — double pipes. Expected: standard single-pipe syntax (reply says already correct).

## Steps

1. Attach to worktree, check out `task/005-shutdown-restart-guidance` branch
2. Rebase on `origin/master`
3. Resolve any conflicts
4. Verify each fix listed above is still present in code
5. Run `pnpm build && pnpm lint && pnpm test`
6. Push (`--force-with-lease`)
7. Report back to governor with results

## Worktree

Use existing worktree at `.git/.wt/25-005-shutdown-restart-guidance`.
