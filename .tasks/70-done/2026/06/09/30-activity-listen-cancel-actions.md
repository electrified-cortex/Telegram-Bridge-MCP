---
id: 30-activity-listen-cancel
title: "activity/listen and activity/listen/cancel MCP actions"
Created: 2026-06-09
Status: queued
Priority: 30
type: feature
Source: operator voice 70439/70440, 2026-06-09; spec by Curator
Delegation: Overseer -> Worker
related: [20-2107-spike-sse-notification-endpoint]
---

# activity/listen and activity/listen/cancel MCP actions

## What this is

Expose the spike's SSE endpoint (`GET /sse?token=<N>`, committed to dev branch in `src/sse-endpoint.ts`)
as two new MCP action paths: `activity/listen` and `activity/listen/cancel`.

These are the TMCP analogue of SIM's `/listen` and `/listen/cancel` routes.

## Background

The SSE spike (task 20-2107, committed 124ccfd) proved `GET /sse?token=<N>` works:
TMCP fires `data: kick` on the SSE stream whenever a new event is enqueued for the session.
The file-based `activity/file/create` + `monitor.sh` approach requires a shared filesystem;
the SSE approach works for any agent that can make HTTP requests, including remote and containerized agents.

Both mechanisms will coexist. `activity/listen` does NOT replace `activity/file/create` — it is
an alternative that agents can choose instead.

## New actions

### activity/listen

**Input:** `{ token: <session-token> }`

**Effect:** no state change. Returns the SSE URL and a ready-to-run curl command.

**Response:**
```json
{
  "ok": true,
  "sse_url": "http://<tmcp-http-host>:<port>/sse?token=<token>",
  "command": "curl -N 'http://<tmcp-http-host>:<port>/sse?token=<token>'"
}
```

The agent uses the returned `command` as the Monitor tool command. On each `data: kick` line the
Monitor fires — the agent then calls dequeue.

**Notes:**
- TMCP must be running in HTTP mode (`--http <port>`) for the SSE endpoint to be reachable.
  If HTTP mode is not active, return `{ ok: false, error: "HTTP_MODE_REQUIRED" }`.
- The `sse_url` must include the correct host/port so remote agents can connect.
  Use the server's configured HTTP listen address (not `localhost` if externally accessible).
  If no HTTP address is configured, use `localhost`.
- Auth: session token integer via `?token=N` (same convention as the existing `/sse` route).
- No new server state is created by this call. The SSE connection is opened when the agent
  starts the curl Monitor, not when this action is called.

### activity/listen/cancel

**Input:** `{ token: <session-token> }`

**Effect:** closes the open SSE connection for this session, if any.

1. Sends `data: cancelled\n\n` on the SSE stream (gives the curl/Monitor process a final line
   to see before the connection drops — lets the agent distinguish clean cancel from drop).
2. Calls `res.end()` to close the stream.
3. Removes the sid from `_connections`.

**Response:**
```json
{ "ok": true }
```
(Returns `{ "ok": true }` even if no connection was open — idempotent.)

## Implementation notes

1. **New action handlers** — create `src/tools/activity/listen.ts` and `src/tools/activity/cancel-listen.ts`.
   Follow the same shape as `src/tools/activity/create.ts`.

2. **Register in `action.ts`** (near line 245 where `activity/file/*` are registered):
   ```ts
   registerAction("activity/listen",        toActionHandler(handleActivityListen));
   registerAction("activity/listen/cancel", toActionHandler(handleActivityListenCancel));
   ```

3. **`kickSseSubscriber`** is already exported from `src/sse-endpoint.ts`. The cancel handler needs
   access to `_connections` — either export a `cancelSseConnection(sid)` function from
   `sse-endpoint.ts`, or add the cancel logic there.

4. **HTTP base URL** — `handleActivityListen` needs to construct the SSE URL. Export a
   `getSseBaseUrl(): string | null` function from wherever the HTTP server stores its bound
   address (likely `src/launcher.ts` or wherever `app.listen()` is called). Return `null` if
   not in HTTP mode.

5. **Discovery / help** — add both paths to the `action.ts` discovery map and `help.ts`
   documentation. Existing help text for `activity/file/create` is a reference for the style.

6. **`data: cancelled` handling** — update the `monitor-reconnect-tmcp.sh` script in `.temp/`
   (from spike 20-2107) to recognize a `data: cancelled` line and exit cleanly (not reconnect).

## Acceptance criteria

- [ ] AC1: `action(type: "activity/listen", token: <N>)` returns `{ ok: true, sse_url: ..., command: ... }`.
- [ ] AC2: Running the returned `command` with Monitor fires a notification on the next dequeue event.
- [ ] AC3: `action(type: "activity/listen/cancel", token: <N>)` closes the SSE connection server-side.
- [ ] AC4: After cancel, the curl/Monitor process receives `data: cancelled` and exits (or is killed cleanly).
- [ ] AC5: Both actions present in discovery (`action()` with no type lists them).
- [ ] AC6: Existing tests still pass; new unit tests added for both handlers.
- [ ] AC7: HTTP_MODE_REQUIRED error returned when TMCP is not in HTTP mode.

## Out of scope

- Removing or deprecating `activity/file/create` (the file-based monitor continues to work)
- Authentication redesign
- Durable reconnect handling (that's the curl + reconnect wrapper, already in .temp/)

## Delegation / gates

Worker implements; Overseer reviews; Curator stages; operator commits.
