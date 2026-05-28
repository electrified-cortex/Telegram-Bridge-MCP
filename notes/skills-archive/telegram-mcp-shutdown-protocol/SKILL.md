---
name: telegram-mcp-shutdown-protocol
description: >-
  How agents should handle Telegram MCP shutdown — wipe token, close session,
  exit loop. Covers both planned and forced shutdowns.
---

# Telegram MCP Shutdown Protocol

## When You Receive a Shutdown Warning

The bridge sends a shutdown warning via dequeue with a countdown. You have
N seconds to wrap up.

## Protocol

1. **Wipe your token** — clear your session token from memory and session file
2. **Close your session** — `action(type: "session/close")`
3. **Exit the loop** — stop dequeuing, end your turn

The `session/close` response includes a hint reminding you to wipe your token
and exit. If your hooks prevent you from stopping, wipe the token first so the
loop guard doesn't block your exit.

## Shutdown Variants

### Governor-initiated warning

The governor can warn all sessions without shutting down:

```
action(type: "shutdown/warn", reason: "planned restart")
```

This lets agents prepare. The governor continues operating and calls shutdown
when ready.

### Shutdown with countdown

```
action(type: "shutdown", countdown: 120)
```

Sends warning to all sessions, waits N seconds, then shuts down. Default: 120s.
`countdown: 0` = immediate shutdown (same as `force: true`).

### Agent response to warning

On receiving a shutdown warning via dequeue:

```
1. Finish current atomic operation (don't start new work)
2. Wipe token from session memory file
3. action(type: "session/close")
4. Exit / stop turn
```

## After Shutdown

If the bridge comes back (planned restart):
- Agents with spawn scripts will detect the bridge is down, wait, then retry
- The negotiate script handles reconnection or fresh session creation
- If `session/bounce` was used, snapshot-based auto-reconnect is available

If the bridge doesn't come back (permanent shutdown):
- Agents exit cleanly since their token is wiped
- The loop guard won't block exit when the token file is cleared

## Key Terms

- **Wipe** = clear token from memory/file (not just forget — actively delete)
- **Close** = `session/close` API call (server-side cleanup)
- **Exit** = stop dequeuing, end the conversation turn
