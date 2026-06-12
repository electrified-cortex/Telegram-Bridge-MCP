---
id: "50-0864"
title: "Session-close confirmation message should include closed session identity"
type: task
priority: 50
status: queued
created: 2026-05-03
repo: Telegram MCP
delegation: Worker
depends_on: []
---

# Session-close confirmation message should include closed session identity

## Background

Operator (2026-05-03) used the per-session "close" button on Telegram. After
clicking and confirming, the message text updated to "✅ Session closed"
(or similar) and the message collapsed. **The collapsed view does not
indicate which session was closed.**

When multiple sessions exist (Curator + Overseer + Worker 1 + Worker 2),
the operator can no longer tell from the chat which one they just closed
without scrolling back or cross-referencing the session list.

## Repro

1. Have multiple agent sessions running.
2. Tap a session's profile pin / management surface that exposes a
   "close" button.
3. Confirm closure.
4. Observe: the confirmation collapses to "Session closed" with no
   identifying name or SID.

## Goal

The post-close message should retain identifying information: session
name and SID. Examples of acceptable end states:

- `✅ Session closed: Worker 2 (SID 4)`
- `✅ Closed: Worker 2 — SID 4`
- `✅ Session 4 (Worker 2) closed`

Pick whichever fits TMCP's existing message-update conventions.

## Acceptance criteria

- After confirming a manual close, the resulting message text in
  Telegram includes both the session name and the session ID.
- Behavior is the same whether the session was closed via:
  - Operator confirm button (as in today's incident).
  - `action(type: "session/close")` from another agent.
  - Force-close (`force: true`).
- Existing collapse / hide-on-close behavior is preserved (this task is
  text-content only).

## Out of scope

- Recolor / restyle of the close-confirmation message.
- Behavior changes on the close itself.
- Adding a close button anywhere new.

## Notes

Filed during 2026-05-03 fleet-wedge incident recovery. Operator
performed a manual close on Worker 2 to clear an unrecoverable session;
the missing identity in the confirmation made it harder than necessary
to verify which session had been closed.

## Bailout

30 minutes. INCONCLUSIVE if the close-confirmation surface lives outside
the parts of TMCP code the worker has access to (escalate location).
