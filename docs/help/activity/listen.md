# activity/listen — SSE Notification Stream

Opens a server-sent events stream so agents can receive push notifications without polling. TMCP emits `data: kick` on each dequeue event; your curl process wakes up and you call `dequeue()`.

**Requires HTTP mode.** Start TMCP with `--http` (or set `MCP_PORT`). Returns `HTTP_MODE_REQUIRED` if TMCP is in stdio mode.

## Actions

| Path | Input | Effect |
| --- | --- | --- |
| `activity/listen` | `token` | Returns the SSE URL and a ready-to-run curl command. No state change. |
| `activity/listen/get` | `token` | Recovery read: same URL/command as `activity/listen`. Call after compaction to re-arm without re-probing HTTP mode. |
| `activity/listen/cancel` | `token` | Closes the open SSE connection for this session. Sends `data: cancelled` then `res.end()`. Idempotent. |

## activity/listen

```
action(type: "activity/listen", token: <token>)
```

Response:
```json
{
  "ok": true,
  "sse_url": "http://127.0.0.1:<port>/sse?token=<token>",
  "command": "curl -N 'http://127.0.0.1:<port>/sse?token=<token>'"
}
```

Pass the `command` string to the `Monitor` tool with `persistent: true`:

```
Monitor(
  command: "<command from response>",
  description: "SSE notify watcher for session <sid>",
  persistent: true
)
```

On each `data: kick` notification from Monitor, call `dequeue(token)`.

## activity/listen/cancel

```
action(type: "activity/listen/cancel", token: <token>)
```

Response: `{ "ok": true }` — idempotent, returns ok even if no connection was open.

The open SSE stream receives `data: cancelled` and then closes. If you are using `monitor-reconnect-tmcp.sh` as the Monitor command, it detects `data: cancelled` and exits cleanly (no reconnect attempt).

## Error modes

- **`HTTP_MODE_REQUIRED`** — TMCP is running in stdio mode; `--http` flag was not passed.
- **`AUTH_FAILED`** — Invalid or missing token.

## Compared to activity/file

| Mechanism | Use when |
| --- | --- |
| `activity/listen` (**preferred**) | TMCP is in HTTP mode and curl is available. Push notifications — no filesystem access needed. |
| `activity/file` (fallback) | stdio mode, or no curl. File-watching Monitor required. Works in both stdio and HTTP mode. |

Both mechanisms trigger the same dequeue poll.

**Capability gate:** call `action(type: "activity/listen")`:
- `ok: true` → HTTP mode active, SSE available — use `activity/listen`.
- `HTTP_MODE_REQUIRED` → stdio mode or no HTTP — fall back to `activity/file`.

## Compaction recovery

After a context compaction, re-arm your SSE monitor:

```
result = action(type: "activity/listen/get", token: <token>)
// result.command is the curl command to re-arm
Monitor(command: result.command, persistent: true, description: "SSE notify watcher")
```

`activity/listen/get` is the symmetric recovery read — same URL/command as `activity/listen`, named explicitly for recovery flows.
