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

- [ ] `session/close` on last session rejects with shutdown hint (without `force`)
- [ ] `session/close` with `force: true` on last session closes normally
- [ ] `session/close` on non-last session is unaffected
- [ ] Tests cover all three cases
