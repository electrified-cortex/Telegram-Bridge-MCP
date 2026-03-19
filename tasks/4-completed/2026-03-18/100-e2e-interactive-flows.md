# Feature: End-to-End Interactive Flow Integration Tests

## Type

Testing

## Priority

100 (high — critical coverage gap)

## Problem

Every interactive tool (`confirm`, `choose`, `ask`, `send_choice`) has strong
unit tests (26, 24, 14, 14 respectively) that mock the callback hook mechanism.
But the **complete round-trip** — tool sends message → callback/reply enqueued to
session queue → `dequeue_update` retrieves it → hook fires → message edited — has
never been tested end-to-end.

Each piece works in isolation. The glue between them has zero integration proof.

## Goal

Create `src/tools/interactive-flows.integration.test.ts` that wires together real
session queues, real callback hooks, and real dequeue logic (still mocking
Telegram API calls) to prove the full interactive lifecycle works.

## Test Scenarios

### SC-1: confirm round-trip

1. Create session, set up session queue
2. Call `confirm` tool (non-blocking — it registers hook + starts polling)
3. Simulate `callback_query` arriving via `recordInbound`
4. Verify hook fires → `answerCallbackQuery` + `editMessageText` called
5. Verify `confirm` resolves with `{ confirmed: true, value: "yes" }`

### SC-2: choose round-trip

1. Call `choose` with 3 options
2. Simulate `callback_query` with one option's data
3. Verify hook fires → correct label returned
4. Verify `choose` resolves with `{ label, value }`

### SC-3: ask text round-trip

1. Call `ask` tool (registers message hook)
2. Simulate text message arriving via `recordInbound`
3. Verify `ask` resolves with `{ text: "user's reply" }`

### SC-4: ask voice round-trip

1. Call `ask` tool
2. Simulate voice message arriving (with transcription)
3. Verify voice auto-ack (`ackVoiceMessage` called)
4. Verify `ask` resolves with transcribed text

### SC-5: send_choice callback

1. Call `send_choice` (returns immediately with `message_id`)
2. Simulate `callback_query` arriving
3. Verify one-shot hook fires → keyboard removed
4. Verify callback event appears in `dequeue_update` result

### SC-6: confirm timeout then late click

1. Call `confirm` with short timeout
2. Let it time out → verify `timed_out: true`
3. Simulate late `callback_query` arriving
4. Verify hook **still fires** (buttons stay live) → message edited
5. Verify late callback appears in subsequent `dequeue_update`

### SC-7: choose voice interruption

1. Call `choose` tool
2. Simulate voice message arriving instead of button press
3. Verify `onVoiceDetected` fires **before** poll resolves
4. Verify `choose` resolves with `{ skipped: true, voice: ... }`

### SC-8: confirm text interruption

1. Call `confirm` tool
2. Simulate text message arriving instead of button press
3. Verify `confirm` resolves with `{ skipped: true, text: "..." }`
4. Verify original buttons are edited to show "Skipped"

## Code References

- `src/tools/confirm.ts` — `pollButtonPress`, message hook registration
- `src/tools/choose.ts` — `pollButtonPress`, `onVoiceDetected`
- `src/tools/ask.ts` — message hook polling
- `src/tools/send_choice.ts` — one-shot callback hook
- `src/tools/button-helpers.ts` — `pollButtonPress`, `ackAndEditSelection`
- `src/message-store.ts` — `recordInbound`, `_callbackHooks`
- `src/session-queue.ts` — `routeToSession`, session queue creation
- `src/tools/dequeue_update.ts` — `dequeueBatch`

## Constraints

- Mock Telegram HTTP calls (`sendMessage`, `answerCallbackQuery`,
  `editMessageText`, `editMessageReplyMarkup`) but use real session queues
  and real callback hook registration
- Use the existing test infrastructure (`test-setup.ts`, `vitest`)
- Each scenario must be independent (no shared state between tests)
- Test file only — no production code changes

---

## Completion Report

**Status:** Done — all 9 tests pass.

**File created:** `src/tools/interactive-flows.integration.test.ts`

**Approach:**

- Mocked only `telegram.js` (`sendMessage`, `answerCallbackQuery`,
  `editMessageText`, `editMessageReplyMarkup`, `ackVoiceMessage`).
- All other modules (message-store, session-queue, session-manager,
  session-context, button-helpers, tool handlers) used real implementations.
- Sessions set up with `createSession` + `setActiveSession` + `createSessionQueue`.
- Blocking tools (confirm, choose, ask) called inside `runInSessionContext`
  with a 20 ms `setTimeout` yield to let the tool register its hook and reach
  the poll wait before injecting events via `recordInbound`.
- `recordInbound` (synchronous) fires callback hooks inline and routes events
  to the session queue, unblocking `pollButtonOrTextOrVoice`.

**Key finding — microtask ordering:** Fire-and-forget hook chains (e.g.
`ackAndEditSelection`) complete one microtask tick *after* `dequeue_update`
resolves. SC-5 and SC-6 needed `await Promise.resolve()` after
`dequeue_update` so that `editMessageReplyMarkup` / `editMessageText` mock
calls were visible before assertions.

**Test count delta:** 1433 → 1442 (+9 new), 74 test files, all green.
