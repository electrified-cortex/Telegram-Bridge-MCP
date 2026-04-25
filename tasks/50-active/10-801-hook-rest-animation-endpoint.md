---
id: 10-801
title: Hook-friendly REST endpoint — POST /hook/animation
status: draft
priority: 10
origin: operator directive 2026-04-24 (split from cortex.lan 15-0584)
---

# Hook-friendly REST endpoint — POST /hook/animation

## Why

PreCompact hooks need to fire a Telegram animation without running the 3-step MCP handshake (initialize → notifications/initialized → tools/call). A shell-script hook with curl-style simplicity is the target UX. The MCP handshake is fine for live agents; it's overkill for a fire-and-forget notification from a hook process.

Narrowly scoped: this endpoint does ONE thing — fires an animation on an authenticated session. Not a generic MCP-over-REST. If other hook use cases emerge, add another narrow endpoint; do not turn this into a general gateway.

## Requirements

- **Method:** `POST /hook/animation`
- **Auth:** session token (same integer token issued by `session/start`) — passed as query param (`?token=N`) or body field. No additional secret; token auth is the bar.
- **Body (JSON):**

  ```json
  {
    "preset": "compacting",
    "timeout": 60,
    "persistent": false
  }
  ```

- **Handler:** reuse the existing `show_animation` tool handler internally. No duplicated animation logic.
- **Response:** `200 OK` on success (fire-and-forget body may be empty or `{"ok": true}`). `401` on invalid token. `400` on invalid preset/body. No response body more than a few bytes.
- **No session mutation:** endpoint must not allocate new session state, rotate tokens, or touch queue/routing. Read the session token, dispatch the animation, return.
- **Failure mode:** endpoint should never crash the bridge. Errors logged, response returned, session continues.

## Acceptance criteria

- [ ] `POST /hook/animation` wired into the bridge HTTP server.
- [ ] Sharing `show_animation` internals — no duplicated code path.
- [ ] Valid token + valid preset → 200 + animation visible on that session.
- [ ] Invalid token → 401, no side effect.
- [ ] Invalid preset → 400, no side effect.
- [ ] Test: integration test confirming the endpoint fires the `compacting` preset end-to-end.
- [ ] Docs: one paragraph in TMCP guide/help explaining the endpoint exists and its narrow scope.

## Don'ts

- Don't generalize this into a REST-over-MCP gateway. Narrow scope = narrow endpoint.
- Don't add new auth primitives. Session token is the bar.
- Don't accept arbitrary tool names — `show_animation` only for this endpoint.
- Don't mutate session state (queues, dequeue defaults, routing).
- Don't add endpoints for session lifecycle (start/close/reconnect). Operator was explicit: agents sign in themselves and get feedback from the normal flow — not via runtime token injection.

## Consumers

- `cortex.lan/tasks/10-drafts/curator-only/15-0584-precompact-direct-animation.md` — blocked on this task.
- Future: any other one-shot hook-driven animation needs (shutdown? stop-hook recovery?). Track as separate tasks, don't pre-build.
