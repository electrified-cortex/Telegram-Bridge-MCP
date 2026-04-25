---
id: 10-493
title: "shutdown action returns NOT_GOVERNOR for the actual governor"
priority: 10
type: bug
status: queued
created: 2026-04-12
---

# 10-493 — Shutdown Returns NOT_GOVERNOR for Actual Governor

## Problem

Governor session (SID 1) called `action(type: 'shutdown')` and received:

```json
{
  "code": "NOT_GOVERNOR",
  "message": "This action requires governor privileges. Only the governor session can call this path.",
  "hint": "Only the governor session can call this action. Use action(token: <governor_token>, ...)."
}
```

This happened after closing all other sessions. SID 1 was the only remaining session and was confirmed governor by `session/list`. The preceding `session/close` on Deputy (SID 2) returned `GOVERNOR_CHANGED` then `PERMISSION_DENIED`, suggesting the governor role may have been reassigned or cleared during the Deputy close sequence.

## Likely Cause

When the Deputy session closed, governor reassignment logic may have set governor to SID 0 or cleared it, even though SID 1 (the actual governor) was still active. Then `shutdown` checked governor SID and found a mismatch.

## Reproduction

1. Start 2 sessions (SID 1 governor, SID 2 non-governor)
2. Governor calls `session/close` targeting SID 2
3. If `GOVERNOR_CHANGED` fires, retry
4. Governor calls `action(type: 'shutdown')`
5. Observe NOT_GOVERNOR error

## Files

- `src/routing-mode.ts` or wherever governor SID is tracked
- `src/session-manager.ts` — session close logic, governor reassignment
- `src/tools/action.ts` — shutdown handler's governor check

## Acceptance Criteria

- [x] Governor closing a non-governor session does not disrupt governor role
- [x] `shutdown` succeeds when called by the actual governor after closing other sessions
- [x] Test: close subordinate session → shutdown → succeeds

## Completion

- **Branch:** `10-493`
- **Worktree:** `D:\Users\essence\Development\cortex.lan\Telegram MCP\.worktrees\10-493`
- **Commit:** `9262ee0` — fix(session): preserve governor role on non-governor 2→1 close (10-493)
- **Root cause:** `session-teardown.ts` unconditionally called `setGovernorSid(0)` on 2→1 transition regardless of `wasGovernor`
- **Fix:** check `wasGovernor` before mutating; non-governor close leaves governor SID untouched; governor close promotes remaining session
- **Tests:** 2220 passed (109 files)
- **Files changed:** `src/session-teardown.ts`, `src/tools/close_session.test.ts`, `src/tools/multi-session-integration.test.ts`, `docs/multi-session-protocol.md`, `changelog/unreleased.md`
- **Completed:** 2026-04-15
