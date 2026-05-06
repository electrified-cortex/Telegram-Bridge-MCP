# Dequeue HTTP Endpoint — GET /dequeue

Dedicated REST endpoint for watcher subprocesses and monitors. Returns the same payload as the `dequeue` MCP tool — no MCP session required.

## Endpoint

```
GET  /dequeue?token=<int>[&max_wait=<0..300>][&connection_token=<uuid>]
POST /dequeue  (JSON body)
```

## Auth

Session token via `?token=<int>` query param (GET) or JSON body field `"token"` (POST). Same integer token used for all bridge endpoints.

## Request: GET (primary shape)

```
GET /dequeue?token=1399313
GET /dequeue?token=1399313&max_wait=0
```

| Param | Required | Description |
| --- | --- | --- |
| `token` | Yes | Session token (integer). |
| `max_wait` | No | Poll timeout in seconds (0 = instant, default = session default). |
| `connection_token` | No | UUID for connection deduplication. |

## Request: POST (alternative)

```json
{
  "token": 1399313,
  "max_wait": 0,
  "connection_token": "uuid-here"
}
```

## Response

Same shape as the MCP `dequeue` tool:

```json
{
  "updates": [...],
  "pending": 0
}
```

Terminal states:

| Field | Meaning |
| --- | --- |
| `empty: true` | No messages within the timeout window. |
| `timed_out: true` | Long-poll expired with no messages. |
| `error: "session_closed"` | The session associated with the token was closed. |

`401 { "ok": false, "error": "<reason>" }` — missing or invalid token.

## Examples

**curl**
```bash
curl "http://localhost:3000/dequeue?token=1399313"
curl "http://localhost:3000/dequeue?token=1399313&max_wait=0"
```

**PowerShell**
```powershell
Invoke-RestMethod "http://localhost:3000/dequeue?token=1399313"
```

**Node.js fetch**
```js
const res = await fetch('http://localhost:3000/dequeue?token=1399313');
const data = await res.json();
```

The underlying contract is a plain HTTP GET — any HTTP client works.

## Notes

- The base URL (`http://localhost:3000` above) is wherever the bridge is listening. Use the same host:port you use for other bridge HTTP calls.
- `max_wait: 0` gives an instant snapshot; omit for blocking long-poll (waits up to the session default timeout).
- This endpoint is equivalent to calling the `dequeue` MCP tool — same validation, same drain loop, same response shape.
