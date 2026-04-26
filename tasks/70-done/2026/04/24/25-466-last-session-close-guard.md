---
Created: 2026-04-10
Status: Backlog
Host: local
Priority: 25-466
Source: Operator
---

# 25-466: Warn last session on close — suggest shutdown instead

## Problem

If the last remaining session calls `session/close`, the server silently
closes it. The agent may not realize they should have called `shutdown`
instead (governor duty). This happened when Curator accidentally closed
its own session instead of shutting down the server.

## Proposed Behavior

When `session/close` is called and the calling session is the **only
remaining session**, the server should:

1. Reject the close
2. Return a warning: "You are the last active session. Use `action(type: 'shutdown')` to shut down the server, or pass `force: true` to close anyway."
3. Accept `session/close` with `force: true` as an override

## Acceptance Criteria

- [x] `session/close` from last session returns warning instead of closing
- [x] Warning message suggests `shutdown` action
- [x] `force: true` parameter overrides the guard
- [x] Normal close behavior unchanged when other sessions exist

## Completion

**Already implemented** — all 4 ACs satisfied by `src/tools/close_session.ts` (lines 25–34), likely shipped as part of task 10-492.

Verified:
- Guard fires when `!force && activeSessionCount() === 1` → returns `LAST_SESSION` error
- Warning text: `"You are the last session. Did you mean to shut down the bridge? Use \`action(type: 'shutdown')\` to stop the service. If you really want to close just your session, call \`action(type: 'session/close', force: true)\`."`
- `force: true` bypasses the guard (condition is `!force`)
- Guard is in the self-close path only; governor-close path is unaffected

No code changes needed. Closing as already-done.
