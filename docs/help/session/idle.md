session/idle — List idle sessions.

Returns sessions that have not polled recently. Useful for governor to detect unresponsive workers.

## Params
token: session token (required)

## Example
action(type: "session/idle", token: 1000001)
→ { idle_sessions: [{ sid: 3, name: "Worker 2", is_governor: false }], idle_count: 1, total_sessions: 4 }

## Use cases
- Governor health check on workers
- Detect stale sessions before routing work
- Identify sessions to close if unresponsive

Related: session/list, session/close, message/route