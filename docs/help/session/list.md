session/list — List all active sessions.

Returns full session details and active SID. Use to identify fellow sessions, governor, and SIDs for routing.

## Params
token: session token (required)

## Example
action(type: "session/list", token: 3165424)
→ { sessions: [{ sid: 1, name: "Primary", color: "🟦", createdAt: ... }, ...], active_sid: 3 }

## Use cases
- Identify governor SID before calling message/route
- Find target_sid before closing another session
- Verify fellow sessions after reconnect

Related: session/start, session/close, message/route, approve