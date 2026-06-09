# activity/listen — SSE Notification Stream

Opens a server-sent events stream so agents can receive push notifications without polling. TMCP emits `data: kick` on each dequeue event; your curl process wakes up and you call `dequeue()`.

**Requires HTTP mode.** Start TMCP with `--http` (or set `MCP_PORT`). Returns `HTTP_MODE_REQUIRED` if TMCP is in stdio mode.

## Actions

| Path | Input | Effect |
| --- | --- | --- |
| `activity/listen` | `token` | Returns the SSE URL and a ready-to-run curl command. No state change. |
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
  description: "SSE kick watcher for session <sid>",
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

| Mechanism | When to use |
| --- | --- |
| `activity/file` | Agent can run a file-watching Monitor (`Monitor` tool with a script). Works in stdio and HTTP mode. |
| `activity/listen` | Agent cannot watch a file but TMCP is in HTTP mode. The SSE stream is the wake signal instead of an mtime bump. |

Both mechanisms trigger the same dequeue poll. Use whichever is available in your environment.
