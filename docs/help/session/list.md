session/list — List all active sessions.

Supports two modes: authenticated (full details) and unauthenticated probe (SIDs only).

## Params
token: session token (optional)
  Omit for unauthenticated SID probe — returns only active SIDs, no auth required.
  Provide a valid token for full session details.

## Authenticated mode (token provided)
action(type: "session/list", token: 3165424)
→ { sessions: [{ sid: 1, name: "Primary", color: "🟦", createdAt: ... }, ...], active_sid: 3 }

## Unauthenticated probe mode (no token)
action(type: "session/list")
→ { sids: [1, 2, 3] }

Use the probe mode after a bridge restart to check whether your SID survived, before attempting a full re-auth.

## Use cases
- Identify governor SID before calling message/route
- Find target_sid before closing another session
- Verify fellow sessions after reconnect

Related: session/start, session/close, message/route, approve