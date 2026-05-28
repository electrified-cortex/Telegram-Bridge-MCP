session/status — Return session metadata for active sessions.

Non-governors see only their own session. The governor sees all active sessions. Useful for health checks, uptime monitoring, and multi-agent coordination.

## Params
token: session token (required)

## Response fields (per session)
sid: session ID
name: session display name
color: color emoji
is_governor: whether this session holds the governor role
createdAt: ISO-8601 creation timestamp
uptime_s: seconds since session was created
last_poll_s: seconds since last dequeue poll (null if never polled)
is_waiting: whether session is currently blocking in dequeue
waiting_s: seconds spent waiting in current dequeue call (null if not waiting)
healthy: bridge health flag

## Example
action(type: "session/status", token: 3165424)
→ { sessions: [{ sid: 1, name: "Curator", color: "🟦", is_governor: true, uptime_s: 3600, last_poll_s: 5, is_waiting: true, waiting_s: 5, healthy: true }] }

Related: session/list, session/start, session/rename
