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

- [ ] `/shutdown` with 0 sessions → instant close
- [ ] `/shutdown` with sessions → warn + timeout + force close
- [ ] `session/close` action with target SID works
- [ ] Service messages for shutdown warn and close signal defined
- [ ] Agent-side token wipe on shutdown (addresses I17 bug)
- [ ] All tests pass

## Delegation

Worker task after spec review. May need Curator input on service
message content.
