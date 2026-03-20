# Task #024 — PR #59 Review Exhaustion (Governor Command)

## Objective

Rebase `task/004-governor-command` on latest `master`, verify all Copilot review fixes are intact, push, and resolve all review threads on PR #59.

## Context

- PR: #59 (`task/004-governor-command` → `master`)
- Worktree: `.git/.wt/20-004-governor-command` (detached HEAD at `6e540da`)
- PR retargeted from `v4-multi-session` to `master`. Rebase onto `master` required.
- Prior session committed fixes and posted "Fixed" replies, but threads remain unresolved.

## Non-Outdated Review Issues (4 threads)

All have "Fixed" replies. Verify after rebase:

1. **Same-governor no-op guard** (`built-in-commands.ts:525`) — selecting already-current governor should no-op, not emit "changed" notifications. Expected: `newSid === oldSid` early return.
2. **Stale panel guard** (`built-in-commands.ts:493`) — governor callback can fire after returning to single-session mode. Expected: `sessions.length < 2` guard with panel edit message.
3. **Expired governor callback** (`built-in-commands.ts:340`) — late taps on dismissed panels should answer callback query, not spin. Expected: `governor:` handler alongside existing `approval:` handler.
4. **Test mock/comment mismatch** (`multi-session-integration.test.ts:71`) — comment says "Real session infrastructure" but module was fully mocked. Expected: partial mock via `importActual`, updated comment.

## Outdated But Unresolved Threads (7 threads)

These also have "Fixed" replies — verify after rebase:

- Partial mock fix in `multi-session-callbacks.test.ts`
- Partial mock fix in `session_start.test.ts`
- Partial mock fix in `close_session.test.ts`
- Stale SID handler in `built-in-commands.ts` — should edit panel with warning when selected session no longer exists

## Steps

1. Attach to worktree, check out `task/004-governor-command` branch
2. Rebase on `origin/master`
3. Resolve any conflicts
4. Verify each fix listed above is still present in code
5. Run `pnpm build && pnpm lint && pnpm test`
6. Push (`--force-with-lease`)
7. Report back to governor with results

## Worktree

Use existing worktree at `.git/.wt/20-004-governor-command`.
