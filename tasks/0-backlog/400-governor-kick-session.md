# Governor Kick Session

**Type:** Feature
**Priority:** 400 (Normal — back burner)

## Description

Allow the governor (or operator via slash command) to forcibly close another session. Currently `close_session` only allows a session to close itself (validates the caller's own `[sid, pin]`).

### Design Questions (open)

- Should only the governor be able to kick? Or operator too (via `/kick`)?
- Should there be a confirmation step or warning to the target session?
- Is this immediate or does the target get a grace period?

### Existing Mechanics

`close_session.ts` already handles full teardown:

- Drains orphaned queue, reroutes to remaining sessions
- Revokes DM permissions
- Cleans up callback hooks
- Promotes new governor if needed
- Sends service messages

The main change: accept a `target_sid` parameter and validate that the caller is the governor (or operator).

### Fallback / Panic

- Operator can always call `/shutdown` to kill everything
- Governor can DM another session asking them to `close_session` voluntarily
- This feature adds a forced option when voluntary close isn't happening

## Code Path

- `src/tools/close_session.ts` — add optional `target_sid`, validate governor authority
- `src/built-in-commands.ts` — add `/kick <sid>` slash command (if operator access desired)
- Tests for governor-only access, self-kick prevention, service messages

## Acceptance Criteria

- [ ] Governor can close another session's SID
- [ ] Non-governors cannot kick
- [ ] Service messages sent to remaining sessions
- [ ] Self-kick rejected (use regular close_session instead)
- [ ] All existing close_session tests still pass
- [ ] Build clean, lint clean, tests pass
- [ ] `changelog/unreleased.md` updated
