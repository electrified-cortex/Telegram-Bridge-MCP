---
id: "10-0873"
title: "HTTP dequeue endpoint — curl-callable from watcher subprocesses"
type: feature
priority: 30
status: draft
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
blocks: ["10-0872"]
---

# HTTP dequeue endpoint for shell watchers

## Why

Activity-file watchers are bash/PS subprocesses that cannot speak MCP — only HTTP. To genuinely drain the queue at wake time (and so eliminate the second turn per inbound message; see 10-0872), the watcher must call dequeue over an HTTP transport.

TMCP already exposes its MCP server over Streamable HTTP at `/mcp` (see `project_sse_keepalive.md`). Two paths:

1. **Use `/mcp` as-is.** Watcher curls a JSON-RPC envelope `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"...","arguments":{...}},"id":1}`. No new endpoint needed; just documentation.
2. **Add a dedicated `/dequeue` endpoint.** Simpler curl shape — `POST /dequeue` with token in header or body, returns the drained events directly without the JSON-RPC envelope. Cleaner for shell users.

**Operator preference (2026-05-05): leaning toward the dedicated `/dequeue` endpoint** — keeps the watcher script simple, no JSON-RPC envelope ceremony. To be confirmed.

## Approach (assuming dedicated endpoint)

Add an HTTP route alongside the existing `/mcp` mount:

```
POST /dequeue
Headers: Authorization: Bearer <token>     (or ?token=<num> query)
Body: { "max_wait": <number>, "connection_token": "<uuid>"? }   (optional)
Response: { "updates": [...] } | { "empty": true } | { "timed_out": true } | { "error": "..." }
```

Same drain semantics as `mcp__telegram-bridge-mcp__dequeue` — wraps the same internal handler. Token validation identical.

## Approach (reusing /mcp)

Document the JSON-RPC envelope shape in the `activity/file` help topic. Provide a copy-pasteable curl one-liner. No code change — just docs.

## Acceptance criteria

- A watcher subprocess (bash or PS) can drain a session's queue via `curl` against the chosen endpoint.
- Drained events match what the in-MCP `dequeue` tool returns for the same call.
- Auth is enforced — invalid token returns 401, no events.
- The `activity/file/create` response hint and `activity/file` help topic point to this endpoint with a complete one-liner example.

## Out of scope

- Migrating the in-MCP `dequeue` tool (it stays, both paths coexist).
- Adding new dequeue features (e.g., the iceboxed `skip` parameter from 10-0872).
- Streaming / long-poll over HTTP — the watcher uses `max_wait: 0` semantics; pure drain.

## Dispatch

Worker-shippable. Haiku-class for documentation-only path; Sonnet for endpoint addition (touches HTTP routing + auth).

## Bailout

If both paths prove harder than expected (e.g., port conflict, auth quirks), surface to Curator. Worker time-cap: 90 minutes for the docs-only path, 4 hours for the dedicated-endpoint path.

## Notes

- See sibling 10-0872 for watcher-side design that consumes this endpoint.
- See `00-ideas/spike-monitor-vs-dequeue-tmcp-2026-05-04.md` for the prior-session spike that mapped the architecture options.
