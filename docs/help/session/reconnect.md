session/reconnect — Reclaim existing session after token loss.

Use only when saved token is unrecoverable (context loss, crash). If token exists, call dequeue(token: ...) directly — no reconnect needed.
Requires operator approval (Approve/Deny dialog). Preserves queued messages.

## Params
name: exact name of session to reclaim (required; case-insensitive match)

## Example
action(type: "session/reconnect", name: "Worker 2")
→ { token: 3165424, sid: 3, action: "reconnected", pending: 4, sessions_active: 2 }

Save token immediately after reconnect.

## After reconnect
1. If pending > 0: drain with dequeue(max_wait: 0, token: ...) loop
2. Load profile: action(type: "profile/load", token: ..., key: "Worker")
3. Enter dequeue loop

## Error cases
SESSION_NOT_FOUND → session closed; start fresh with session/start
SESSION_DENIED → operator denied reconnect

Related: session/start, session/list, profile/load