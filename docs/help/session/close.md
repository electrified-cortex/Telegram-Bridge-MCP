session/close — Close current session (or another session if governor).

Self-close: omit target_sid. Governor-close: provide target_sid (requires operator confirmation).
Session ID cannot be reclaimed after closure. No tool calls after closing own session.

## Params
token: session token (required)
target_sid: SID of session to close (optional; governor only — omit for self-close)
force: set true to close the last remaining session directly — bypasses the last-session guard (optional; omit unless intentionally closing the only active session without shutting down the bridge)

## Examples
Self-close (shutdown flow):
action(type: "session/close", token: 3165424)
→ { closed: true, sid: 3, reason: "closed" }

Governor closes another session:
action(type: "session/close", token: 1000001, target_sid: 3)
→ { closed: true, sid: 3, reason: "closed" }

Last-session close (LAST_SESSION error recovery):
action(type: "session/close", token: 3165424)
→ { isError: true, code: "LAST_SESSION", message: "You are the last session..." }
action(type: "session/close", token: 3165424, force: true)
→ { closed: true, sid: 3, reason: "closed" }

## Rules
- Always drain queue before closing: dequeue(token: ..., max_wait: 0) until empty
- DM superior before closing
- Wipe session memory file before close
- No tool calls after session/close

Full procedure: help(topic: 'shutdown')

Related: session/list, shutdown, shutdown/warn