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

- [ ] shutdown/warn DM includes session cleanup instructions
- [ ] Instructions mention deleting stored token
- [ ] Instructions say to NOT retry after closure
- [ ] Agent-facing text is concise (Ultra tier)
