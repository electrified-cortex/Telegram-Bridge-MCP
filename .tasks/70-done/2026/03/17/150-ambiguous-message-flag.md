# Feature: Ambiguous Message Flag in Dequeue Response

## Type

Feature / Routing UX

## Description

When governor routing is active, `dequeue_update` should include a `routing` field on each event so the receiving agent knows whether the message was targeted (reply-to a known bot message) or ambiguous (fresh message, no reply-to context).

This lets agents implement the multi-session protocol: "Did the user mean this for me, or should I route it elsewhere?"

## Dependencies

- **200-governor-default-routing** — governor mode must be active for ambiguous vs targeted to matter

## Current State

`dequeue_update` returns events as `{ id, event, from, content }`. There is no routing metadata. The routing decision happens in `session-queue.ts` `routeMessage()` but the result isn't propagated to the consumer.

## Code Path

1. `src/session-queue.ts` — `routeMessage()` already classifies messages as targeted (reply-to) or ambiguous (fresh)
2. `src/message-store.ts` — `recordInbound()` stores events; could tag routing metadata
3. `src/tools/dequeue_update.ts` — formats the response; would include the routing field
4. `src/update-sanitizer.ts` — strips fields from events before returning to agent

## Design

### Event shape (multi-session, governor active)

```json
{
  "id": 8910,
  "event": "message",
  "from": "user",
  "routing": "ambiguous",
  "content": { "type": "text", "text": "Hey, can you check on that?" }
}
```

### Routing values

| Value | Meaning |
| --- | --- |
| `"targeted"` | User replied to a bot message → routed to the session that sent it |
| `"ambiguous"` | Fresh message, no reply-to → routed to governor by default |
| (omitted) | Single-session mode or no routing active |

### Agent protocol

When an agent dequeues a message with `routing: "ambiguous"`:

1. Consider: "Is this for me based on context?"
2. If yes → handle normally
3. If no → use `route_message(target_sid)` to forward
4. If unsure → handle it (governor is the fallback, it's OK)

## Acceptance Criteria

- [x] `dequeue_update` includes `routing: "ambiguous"` or `routing: "targeted"` on events when governor routing is active
- [x] `routing` field is omitted entirely in single-session mode (backward compat)
- [x] Targeted messages (reply-to bot message) tagged as `"targeted"`
- [x] Ambiguous messages (no reply-to) tagged as `"ambiguous"`
- [x] Test: governor active + fresh message → `routing: "ambiguous"`
- [x] Test: governor active + reply-to → `routing: "targeted"`
- [x] Test: single session → no `routing` field
- [x] All tests pass: `pnpm test`
- [x] No new lint errors: `pnpm lint`
- [x] Build clean: `pnpm build`

## Completion

**Agent:** GitHub Copilot (worker session)
**Date:** 2026-03-17

### What Changed

- `src/tools/dequeue_update.ts` — Added `getMessageOwner` import from `session-queue.js`.
  In `compactEvent`, when `getRoutingMode() === "governor"`, classifies each event:
  `reply_to` with known owner → `"targeted"`, `target` (callback) with known owner →
  `"targeted"`, everything else → `"ambiguous"`. Field is entirely absent for
  `load_balance` and `cascade` modes.
- `src/tools/dequeue_update.test.ts` — Added `getMessageOwner` mock (default returns 0).
  Added 7 new tests in a `"routing field"` describe block covering: ambiguous fresh message,
  targeted reply-to, targeted callback, omitted in load_balance, omitted in cascade,
  batch routing applied to all events, and untracked reply-to treated as ambiguous.

### Test Results

- Tests added: 7 new (routing field describe)
- Total: 1364 (all passing)
- lint: clean
- build: clean
