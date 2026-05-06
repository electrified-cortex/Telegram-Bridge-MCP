---
id: "10-0873"
title: "Dedicated /dequeue HTTP endpoint — curl-callable from watcher subprocesses"
type: feature
priority: 30
status: draft
created: 2026-05-05
updated: 2026-05-05
repo: Telegram MCP
delegation: Worker
blocks: ["10-0872"]
---

# Dedicated /dequeue HTTP endpoint

## Operator decision (2026-05-05)

> "We need a custom endpoint for DQ. It's that simple. Not a big deal. We've been building out the HTTP on demand at the moment, so why not. There's no security model, really, that we have to worry about — it's just a matter of can the local models or agents call into it. Just expose DQ as a simple call. The full message — the whole JSON payload — same behavior as if they were just calling DQ from MCP."

Decision: ship a dedicated `/dequeue` HTTP route. Do NOT route through `/mcp` (which is wrapped by MCP SDK's `StreamableHTTPServerTransport` and requires an `mcp-session-id` header — verified in `src/index.ts:149`). A raw curl against `/mcp` returns 400 "No valid session ID."

## Behavior

**Primary shape (operator preference): `GET /dequeue?token=<num>`** — simplest possible curl, no body, no headers. Optional query params: `max_wait`, `connection_token`.

```
GET /dequeue?token=1399313
GET /dequeue?token=1399313&max_wait=0
```

Also accept `POST /dequeue` with JSON body for callers that need to set richer args:

```json
{
  "token": <session_token>,
  "max_wait": <0..300>?,
  "connection_token": "<uuid>"?
}
```

Response: **identical shape to the MCP `dequeue` tool result.** Same `updates` array, same `pending`, same `empty: true` / `timed_out: true` / `{ error: "session_closed" }` paths. Caller sees no behavioral difference vs the MCP tool.

Auth: token validates against the session registry exactly as the MCP tool does. No additional security layer (operator: local-only consumer, no security model needed).

## Help-topic shape (platform-agnostic)

Per operator (2026-05-05): the `activity/file` help topic must be platform-agnostic. Express **intent**, not one shell:

> "Call `GET <base-url>/dequeue?token=<your-token>` from your monitor's wake action. The response is the same JSON you would get from the `dequeue` MCP tool."

Show one example for each common environment (curl, PowerShell `Invoke-RestMethod`, Node `fetch`) but make it clear the underlying contract is just an HTTP GET — any tool that can speak HTTP works.

## Implementation

The MCP `dequeue` tool already wraps the internal drain handler. Refactor (if needed) so the handler is a pure function callable from both the MCP tool path and the new HTTP route. Both paths share validation + drain + response shape.

Express route mount: alongside the existing `/mcp` route in `src/index.ts`. Not behind any transport — direct Express handler.

## Acceptance criteria

- `GET /dequeue?token=<num>` returns events for a valid token, identical in shape to the MCP tool result. **Primary shape.**
- `POST /dequeue` with JSON body works for the same call shape.
- Invalid token returns 401 with a clear error body.
- `max_wait: 0` instant-poll behavior matches the MCP tool.
- Same `pending`, `empty`, `timed_out`, `error: "session_closed"` semantics.
- `activity/file/create` response hint or related help topic describes the GET shape platform-agnostically (intent: "call this URL"), with examples for curl + PowerShell + Node fetch.
- The MCP `dequeue` tool continues to work unchanged.

## Out of scope

- Exposing other tools as REST. **Iceboxed** — see below.
- Auth headers / API keys / etc.
- Long-poll over SSE (caller passes `max_wait`; same blocking semantics as the MCP tool).

## Iceboxed (separate idea, not this task)

Operator noted: "we were considering can we actually just expose everything that the MCP has as a RESTful HTTP. I think as an interim check that's like maybe an icebox thing." Captured for a future task — generic REST surface mirroring the MCP tool catalog. NOT part of 10-0873.

## Dispatch

Worker-shippable. Sonnet-class — touches HTTP routing, request validation, response shape parity. Tests: 4–6 cases (happy path, invalid token, instant poll, blocking poll cut short, session-closed, parity-with-MCP-tool).

## Bailout

If the internal drain handler isn't easily extractable to a pure function, escalate to Curator — may need a small refactor first that's better as its own task.

Worker time-cap: 4 hours including tests. Checkpoint with Curator if exceeded.

## Related

- `10-0872` (watcher pre-drain consumes this endpoint).
- `10-0871` (activity/file help topic — references this URL after merge).
- `00-ideas/spike-monitor-vs-dequeue-tmcp-2026-05-04.md` (prior architecture survey).

## Completion

- Branch: `10-0873`
- Commit: `493ea987ca668c58ad641119180c48aca9c64f7d`
- New files: `src/dequeue-endpoint.ts`, `src/dequeue-endpoint.test.ts`
- Modified: `src/tools/dequeue.ts` (extracted `runDrainLoop`; fixed session_closed/setDequeueActive bug), `src/index.ts`
- Build: pnpm build GREEN
- Tests: pnpm test GREEN (2972 tests, 0 failures — 17 new endpoint tests)
- Code review: PASSED (1 Critical + 2 Majors fixed; 2 iterations)
- Worker: Worker 2

## Verification

**Verdict: NEEDS_REVISION** — 2026-05-05
Verified by: Overseer dispatch (Sonnet verifier)

### Passing (6/7 AC)
- AC1 ✅ `GET /dequeue?token=<num>` — `attachDequeueRoute` registers handler, delegates to `runDrainLoop`, response shape from `runDrainLoop` directly
- AC2 ✅ `POST /dequeue` with JSON body — registered at line 101, body merged into args
- AC3 ✅ Invalid token → 401 with clear error body (3 paths: missing, non-numeric, validateSession failure)
- AC4 ✅ `max_wait: 0` instant poll — parsed and passed as `effectiveTimeout=0` to `runDrainLoop`; test confirms
- AC5 ✅ Same `pending`/`empty`/`timed_out`/`error:session_closed` semantics — structural parity (both paths call same `runDrainLoop`)
- AC7 ✅ MCP `dequeue` tool unchanged — `runDrainLoop` exported from `src/tools/dequeue.ts:121`, `register()` untouched
- setDequeueActive bug ✅ Confirmed fixed: `session_closed` check fires before `setDequeueActive(sid, true)` (line 140); `finally` block unconditionally calls `setDequeueActive(sid, false)` covering all paths

### Gap (blocking)

**AC6 — Help topic not updated**
`src/tools/activity/create.ts` hint text at lines 51 and 78 still reads:
`"Configure your watcher to call dequeue() when this file changes"` — no HTTP URL, no curl/PS/Node examples.
`docs/help/dequeue.md` is unchanged and has no HTTP endpoint reference.

**Required fix:** Update the `activity/file/create` response hint to reference the `/dequeue` HTTP URL with platform-agnostic intent. Add examples for curl, PowerShell `Invoke-RestMethod`, and Node `fetch`. Pattern: follow `docs/help/events.md` (endpoint shape, auth, request/response table). Can be new `docs/help/dequeue-http.md` or update existing `docs/help/dequeue.md`.
