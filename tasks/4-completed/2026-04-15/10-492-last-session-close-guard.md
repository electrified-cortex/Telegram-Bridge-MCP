---
id: 10-492
title: Guard against closing the last session without shutdown intent
priority: 10
type: bug
status: queued
created: 2026-04-12
---

# 10-492 — Last Session Close Guard

## Problem

When the last remaining session (governor) calls `session/close`, it silently closes and leaves the bridge running with zero sessions. The agent thinks it shut down cleanly, but the bridge is orphaned — still listening on port, no sessions to serve.

This caused a false-positive hook trigger: the bridge was reachable but no session existed.

## Expected Behavior

`session/close` on the **last active session** should reject with a hint:

> "You are the last session. Did you mean to shut down the bridge? Use `action(type: 'shutdown')` to stop the service. If you really want to close just your session, call `action(type: 'session/close', force: true)`."

## Changes Required

1. **`session/close` handler** — detect when the calling session is the last one:
   - If last session AND `force` is not `true` → reject with hint (not an error — a guard)
   - If last session AND `force: true` → close normally
   - If not last session → close normally (no change)
2. **Schema update** — add optional `force: boolean` parameter to `session/close` action
3. **Tests** — last-session guard rejects without force, passes with force, non-last session unaffected

## Files

- `src/tools/action.ts` — add force param to session/close schema + pass through
- `src/tools/session_start.ts` (or wherever session/close is handled) — guard logic
- Tests for the above

## Acceptance Criteria

- [x] `session/close` on last session rejects with shutdown hint (without `force`)
- [x] `session/close` with `force: true` on last session closes normally
- [x] `session/close` on non-last session is unaffected
- [x] Tests cover all three cases

## Completion

- **Branch:** `10-492`
- **Worktree:** `D:\Users\essence\Development\cortex.lan\Telegram MCP\.worktrees\10-492`
- **Commit:** `c7512f1` — feat(session): add last-session close guard (10-492)
- **Tests:** 2222 passed (109 files)
- **Files changed:** `src/tools/close_session.ts`, `src/tools/action.ts`, `src/tools/close_session.test.ts`, `src/tools/multi-session-integration.test.ts`, `src/telegram.ts`, `src/tools/help.ts`, `changelog/unreleased.md`
- **Completed:** 2026-04-15
