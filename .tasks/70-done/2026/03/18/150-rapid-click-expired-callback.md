# Feature: Rapid Double-Click and Expired Callback Tests

## Type

Testing

## Priority

150 (high — defensive edge case)

## Problem

No tests verify what happens when a user presses the same inline button
multiple times in rapid succession. The first press fires the hook, edits the
message, and removes the keyboard. But Telegram may still deliver the 2nd and
3rd `callback_query` events. These arrive with the same `message_id` but may
get "query is too old" from Telegram when we try to `answerCallbackQuery`.

The code in `button-helpers.ts` swallows `answerCallbackQuery` errors, which
*should* handle this gracefully — but it's never been tested.

Similarly, Telegram expires `callback_query` after ~30 seconds. If the agent
processes a callback late, `answerCallbackQuery` will fail with "query is too
old and response timeout expired." This path is also untested.

## Test Scenarios

### SC-1: Double click — second callback ignored gracefully

1. Send `confirm` message with inline keyboard
2. Simulate first `callback_query` → hook fires, message edited, buttons
   removed
3. Simulate second `callback_query` (same message_id, different query_id)
4. Verify no crash, second `answerCallbackQuery` error swallowed
5. Verify `confirm` only resolves once (first result wins)

### SC-2: Triple rapid click on choose

1. Send `choose` with 3 options
2. Simulate 3 `callback_query` events in rapid succession (same button)
3. Verify only first fires the hook
4. Verify no duplicate edits to the message

### SC-3: Expired callback — late answerCallbackQuery

1. Send `confirm` with inline keyboard
2. Simulate `callback_query` arriving
3. Mock `answerCallbackQuery` to throw "query is too old"
4. Verify error is swallowed — no crash
5. Verify message edit still succeeds (edit is independent of ack)
6. Verify `confirm` still resolves with correct value

### SC-4: send_choice — click after keyboard already removed

1. Call `send_choice` → one-shot hook registered
2. First `callback_query` → hook fires, keyboard removed
3. Second `callback_query` → hook already consumed (one-shot)
4. Verify second callback appears as unhandled in `dequeue_update`

## Code References

- `src/tools/button-helpers.ts` — `ackAndEditSelection` error swallowing
- `src/tools/confirm.ts` — `pollButtonPress` callback matching
- `src/tools/choose.ts` — `pollButtonPress` callback matching
- `src/tools/send_choice.ts` — one-shot hook registration
- `src/message-store.ts` — `_callbackHooks` lifecycle

## Constraints

- Test file: `src/tools/callback-edge-cases.test.ts`
- Mock Telegram API calls, use real hook infrastructure
- Each scenario independent
- Test file only — no production code changes

## Completion

**Agent:** GitHub Copilot (Claude Sonnet 4.6)
**Date:** 2026-03-18

### What Changed

- Created `src/tools/callback-edge-cases.test.ts` — 4 new integration tests covering all
  specified scenarios. No production code was modified.

### Test Results

- Tests added: 4 new tests
- Total tests: 1446 (all passing, up from 1442)
- New test file lints clean; pre-existing lint errors in unrelated files are out of scope

### Findings

- The `_callbackHooks` map is correctly one-shot: deletes before calling, so rapid
  re-entry is impossible. Second/third clicks have no hook to fire.
- `ackAndEditSelection` error swallowing is confirmed end-to-end: `answerCallbackQuery`
  failure (mocked to reject) does NOT prevent the subsequent `editMessageText` call
  because they are separate `await` statements with independent `.catch()` on the first.
- `send_choice`'s one-shot hook is consumed on first click; second click routes to the
  session queue via normal broadcast routing and appears in `dequeue_update` as expected.
- Callback routing without `trackMessageOwner` (because the outbound proxy is mocked) still
  works via broadcast fallback — the single active session receives all events.

### Acceptance Criteria Status

- [x] SC-1: Double click — second callback ignored gracefully (confirm resolves once, ack called once)
- [x] SC-2: Triple rapid click on choose — only first fires hook, no duplicate edits
- [x] SC-3: Expired callback — `answerCallbackQuery` error swallowed, message edit still succeeds
- [x] SC-4: send_choice — second click after hook consumed shows up in `dequeue_update`
