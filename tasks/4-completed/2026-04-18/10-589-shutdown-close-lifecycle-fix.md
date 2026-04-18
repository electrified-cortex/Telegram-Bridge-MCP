# 10 — Shutdown/Close Lifecycle Fix

## Summary

Fix the shutdown and session close flow. `/shutdown` hangs when no
sessions are active. Governor has no clean way to direct a session to
close. The full lifecycle needs to work end-to-end.

## Problems

1. `/shutdown` with zero active sessions should be instant (write log,
   close bridge). Currently hangs on pending message safety guard.
2. No `session/close/signal` action for governor to request a specific
   session to shut down gracefully.
3. `shutdown/warn` exists but the full warn → close → force-close flow
   isn't wired up.

## Requirements

### Bridge `/shutdown` command
- Zero sessions active → skip all guards → write log → close. Instant.
- Sessions active → `shutdown/warn` service message to all sessions
  with countdown → wait N seconds → force close remaining.

### Governor-directed session close
- New action: `session/close` with target SID
- Sends service message to target session: "Governor requested shutdown.
  Save state and call session/close within N seconds."
- Timeout → force-close the session
- Governor can still call `shutdown` to close everything

### Agent-side shutdown hook
- On receiving shutdown signal service message, agent should:
  1. Save state (handoff doc, session memory)
  2. Wipe session token file
  3. Call session/close
- This is the proper shutdown procedure — no dangling tokens

## Acceptance Criteria

- [x] `/shutdown` with 0 sessions → instant close
- [x] `/shutdown` with sessions → warn + timeout + force close
- [x] `session/close/signal` action for governor-directed graceful close
- [x] Service message for close signal defined (`session_close_signal` event type)
- [ ] Agent-side token wipe on shutdown (I17) — agent-side config, out of scope for this task
- [x] All tests pass (54/54)

## Completion

**Completed:** 2026-04-17
**Branch:** `10-shutdown-close-lifecycle-fix` (Telegram MCP repo)
**Commit:** `b69dca5`

**Changes:**
- `src/tools/shutdown.ts` — early exit when `listSessions().length === 0`; skips pending guard
- `src/tools/close_session_signal.ts` — new `session/close/signal` action; governor-only; delivers service message to target; polls 30s for self-close; force-closes on timeout
- `src/tools/action.ts` — registers `session/close/signal` with `{ governor: true }`
- `src/shutdown.ts` — replaces 2s fixed delay with 10s polling loop + force-close of remaining sessions

**Note:** Pre-existing tsc errors in `session-lifecycle.ts` (not caused by this branch). Agent-side token wipe (I17) is agent config work, not server-side.

## Delegation

Worker task after spec review. May need Curator input on service
message content.
