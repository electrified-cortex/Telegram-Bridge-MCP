# Feature: Auto-Grant DM on Session Approval

## Type

Feature / UX

## Priority

250

## Description

When the operator approves a new session joining, automatically grant bidirectional DM permissions between the new session and all existing sessions. The session approval IS the trust gate — requiring a separate `request_dm_access` approval is redundant friction.

## Current State

- `request_dm_access` tool exists — sends operator a confirm prompt, waits for approval
- `dm-permissions.ts` — per-direction permission map (sender → target)
- `send_direct_message` requires DM permission to be granted first
- Governor can't DM workers without operator approval for each direction

## Design

### On Session Approval

When `session_start` successfully creates a session (after operator approval), automatically call `grantDmPermission(newSid, existingSid)` and `grantDmPermission(existingSid, newSid)` for every existing session.

### Result

- Governor can DM workers immediately (no friction)
- Workers can DM governor back ("I'm done, what next?")
- `request_dm_access` tool remains available for edge cases or future stricter modes
- `send_direct_message` works out of the box for any session pair

### Message Attribution

DMs already include the sender session name. No changes needed — source is always clear.

## Acceptance Criteria

- [ ] `session_start` auto-grants bidirectional DM between new session and all existing sessions
- [ ] `send_direct_message` works immediately after session approval without `request_dm_access`
- [ ] `request_dm_access` tool still functional (not removed)
- [ ] Tests for auto-grant on session join
- [ ] Tests that DM works without prior permission request
- [ ] Changelog updated
