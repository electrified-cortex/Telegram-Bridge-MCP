# Feature: Multi-Session Callback Isolation Tests

## ⚠️ Needs Clarification Before Implementation

1. **Wrong file path in Code References and Constraints.** References
   `src/tools/multi-session-integration.test.ts` — this file does not exist.
   The real file is `src/multi-session.integration.test.ts` (at `src/` root,
   not inside `src/tools/`). Correct the path before implementation.

2. **SC-3 has no specified expected outcome.** The scenario says "Verify: hook
   still fires… OR hook is cleaned up on session close? Document whichever is
   correct." This is not a test — it's an open design question. Before writing
   this scenario, decide: **should hooks survive session close or be cleaned
   up?** Pin the expected behavior in the spec, then write the test to assert
   it.

3. **SC-4 references an undefined concept: "Governor".** The scenario says
   "Governor (SID 1) routes incoming text to SID 2" without explaining what
   a Governor is or how to set one up in a test. Either define the Governor
   routing setup steps explicitly, or rewrite SC-4 using concrete session and
   routing-mode primitives (`setRoutingMode`, etc.).

## Type

Testing

## Priority

200 (medium — important for multi-session correctness)

## Problem

The multi-session integration tests (`multi-session-integration.test.ts`) verify
queue isolation, SID enforcement, voice ack, and routing. But they never test
interactive button flows across sessions:

- SID 1 sends a `confirm` → user clicks → does the callback route to SID 1's
  queue?
- SID 1 sends buttons, SID 2 also sends buttons → callbacks for each route to
  the correct session?
- Session closes while buttons are live → what happens to pending callbacks?

Callback hooks are registered globally in `_callbackHooks` (keyed by
`message_id`). The hook fires inline during `recordInbound` before any queue
routing. This means the hook owner (the session that sent the buttons) handles
the callback regardless of which session "owns" the chat. This is correct
behavior — but it needs test proof.

## Test Scenarios

### SC-1: Callback routes to sending session

1. Create SID 1 and SID 2
2. SID 1 calls `confirm` → hook registered for `message_id` X
3. Simulate `callback_query` for `message_id` X
4. Verify SID 1's `confirm` resolves (hook fired)
5. Verify SID 2's queue does NOT contain the callback event

### SC-2: Concurrent buttons — independent hooks

1. SID 1 calls `confirm` → hook for `message_id` 100
2. SID 2 calls `choose` → hook for `message_id` 200
3. Simulate callback for `message_id` 200 → SID 2's `choose` resolves
4. Simulate callback for `message_id` 100 → SID 1's `confirm` resolves
5. Neither session sees the other's callback in `dequeue_update`

### SC-3: Session close during button wait

1. SID 1 calls `confirm` (starts polling)
2. Close SID 1
3. Simulate `callback_query` for SID 1's message
4. Verify: hook still fires (hooks are message-scoped, not session-scoped)?
   OR hook is cleaned up on session close? Document whichever is correct.
5. Verify no crash either way

### SC-4: Governor routes message, then button callback arrives

1. Governor (SID 1) routes incoming text to SID 2
2. SID 2 calls `confirm` in response
3. User clicks the button
4. Verify callback reaches SID 2's hook (not governor)
5. Verify governor's queue is not polluted

## Code References

- `src/message-store.ts` — `_callbackHooks`, `recordInbound`
- `src/session-queue.ts` — `routeToSession`, per-session queues
- `src/session-manager.ts` — `closeSession`
- `src/tools/confirm.ts`, `src/tools/choose.ts`
- `src/tools/multi-session-integration.test.ts` — existing patterns

## Constraints

- Extend `src/tools/multi-session-integration.test.ts` or create a new file
  `src/tools/multi-session-callbacks.test.ts`
- Mock Telegram API, use real session queues and hooks
- Test file only — no production code changes
