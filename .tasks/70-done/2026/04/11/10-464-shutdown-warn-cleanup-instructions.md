---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-464
Source: Operator observation — Overseer tried to reconnect after shutdown warning
---

# 10-464: Shutdown warning should include session cleanup instructions

## Problem

When the governor sends `shutdown/warn`, the DM tells agents to wrap up but
doesn't instruct them to delete their stored session token. The Overseer's
spawn script kept retrying connection after the session was closed — it
didn't know the session was dead.

## Proposed Fix

The `shutdown/warn` DM should include explicit instructions:
1. Write handoff document
2. Delete session token from memory
3. Do NOT retry connection — session is being terminated
4. Call `action(type: "session/close")` to cleanly close

## Acceptance Criteria

- [x] shutdown/warn DM includes session cleanup instructions
- [x] Instructions mention deleting stored token
- [x] Instructions say to NOT retry after closure
- [x] Agent-facing text is concise (Ultra tier)

## Completion

**Branch:** `10-464` | **Commit:** `a73738f`

### What changed (3 files)

- **`src/tools/notify_shutdown_warning.ts`** — Replaced `BASE_WARNING` (which embedded `RESTART_GUIDANCE` for server restart reconnect) with new `SHUTDOWN_CLEANUP` constant covering all 4 required actions. Fixed `wait_seconds` label from "Estimated restart time" to "Shutdown in". Fixed schema descriptions from "restart" to "shutdown" terminology.
- **`src/tools/notify_shutdown_warning.test.ts`** — Updated existing assertion `"restarting soon"` → `"session termination imminent"`. Added new test asserting both `"session/close"` and `"delete stored session token"` appear in DM text.
- **`src/action-registry.ts`** — Removed redundant `Promise<unknown> |` from `ActionHandler` return type (pre-existing lint fix).

### Notes

- `restart-guidance.ts` `RESTART_GUIDANCE` constant still used by `shutdown.ts` (hard-shutdown DM for server restart path). Not removed.
- Code review: Minor finding (restart label contradiction) — fixed before commit.
- 2202 tests pass.
