# Bounce / Restart Protocol

## Overview

The bridge supports two restart modes:

| Mode | State file | Reconnect approval |
|------|------------|--------------------|
| **Planned bounce** | `session-state.json` with `plannedBounce: true` | Skipped — token accepted automatically |
| **Unplanned crash** | File absent or `plannedBounce: false` | Required — operator must approve via dialog |

---

## Planned Bounce

A planned bounce is triggered by `action(type: "session/bounce", ...)` or by calling `elegantShutdown(planned: true)`.

### What happens

1. `markPlannedBounce()` writes `session-state.json` with `plannedBounce: true` and the current session list.
2. All active sessions receive a service message:
   > ⚡ Server bouncing for fast restart. Session state saved. Wait ~30s then probe.
3. The server shuts down cleanly.
4. On restart, `restoreSessions()` reads `session-state.json`, restores session state, sets `plannedBounce` flag in memory, and clears the flag from the file.
5. Agents reconnect with their saved token — no approval dialog is shown.

### Agent reconnect procedure (planned bounce)

```
# Step 1: Probe — no token needed
action(type: "session/list")
# → { sids: [1, 2, 3] }

# Step 2: If your SID is present, reconnect with your saved token
action(type: "session/reconnect", token: <saved_token>, name: "<your_name>")
# → { token, sid, pin, action: "reconnected", ... }

# Step 3: Resume dequeue loop as normal
```

If the probe returns `{ sids: [] }` or your SID is absent, the bridge restarted fresh — use `session/start` instead.

---

## Unplanned Crash

If the bridge crashes without a planned bounce, `session-state.json` either does not exist or contains `plannedBounce: false`. The session queue is empty and SIDs are gone.

### Agent recovery procedure (unplanned crash)

```
# Probe first — no token needed
action(type: "session/list")
# → { sids: [] }  (empty — fresh restart)

# Start a new session
action(type: "session/start", name: "<your_name>")
```

---

## Unauthenticated SID Probe

`list_sessions` accepts an optional token. When called without a token it returns only the list of active SIDs:

```
action(type: "session/list")
# → { sids: [1, 2] }
```

No auth is required. This is safe to call immediately after a restart to determine which reconnect path to take.

---

## State File

Location: `session-state.json` at the project root (next to `mcp-config.json`).

Schema:

```json
{
  "nextId": 3,
  "sessions": [
    { "sid": 1, "pin": 123456, "name": "Governor", "color": "🟦", "createdAt": "..." },
    { "sid": 2, "pin": 654321, "name": "Worker",   "color": "🟩", "createdAt": "..." }
  ],
  "plannedBounce": true
}
```

The `plannedBounce` field is cleared (set to `false`) immediately after being read on startup so a second restart without a new bounce does not incorrectly skip approval.

---

## Implementation Notes

- `bounce-state.ts` — in-memory flag (`isPlannedBounce()`, `setPlannedBounce()`)
- `session-manager.ts` — `persistSessions()`, `restoreSessions()`, `markPlannedBounce()`
- `shutdown.ts` — calls `markPlannedBounce()` at the start of `elegantShutdown(planned: true)`
- `index.ts` — calls `restoreSessions()` after `loadConfig()`, sets the in-memory flag
- `tools/list_sessions.ts` — token is optional; unauthenticated path returns `{ sids: [...] }`
- `tools/session_start.ts` — `handleSessionReconnect` skips approval when `isPlannedBounce()` is true
