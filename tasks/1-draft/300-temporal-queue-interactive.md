# Feature: Temporal Queue + Interactive Flow Integration

## ⚠️ Needs Clarification Before Implementation

1. **SC-1/SC-2/SC-3 setup mechanics are ambiguous.** The scenarios describe
   enqueuing `[text₁, callback₁, text₂]` or `[reaction₁, voice(pending)]`
   without specifying HOW. Two possible interpretations:
   - Construct a standalone `TemporalQueue` directly and push raw events
     (pure unit test approach)
   - Route events through `recordInbound` so real hook dispatch fires first
     (integration test approach)
   These produce different test shapes. The scenarios must specify which
   approach to use — and if the latter, note that a hooked `callback` would
   be intercepted before reaching the queue (see SC-4 vs SC-1 tension).

2. **"Mark voice ready" mechanism in SC-2 is not specified.** Voice messages
   are considered pending until transcription completes. Describe exactly how
   to simulate transcription completion in a test context (e.g., call
   `recordInbound` again with the same message id plus a `text` field, or
   invoke an internal setter).

3. **"reaction₁" event structure in SC-2 is undefined.** Specify the exact
   shape of a reaction event that `isHeavyweightEvent` / `TemporalQueue`
   treats as lightweight (e.g., is this a `message_reaction` update, and what
   fields does the test need?).

4. **SC-1's batch steps appear to assume a specific `dequeueBatch` semantic —
   verify against the actual implementation.** Confirm that the TemporalQueue
   batch semantics described in the steps match the real behavior in
   `src/temporal-queue.ts` (or `src/session-queue.ts`) before writing the
   assertions.

## Type

Testing

## Priority

300 (normal — validates queue + interaction interplay)

## Problem

The temporal queue (`temporal-queue.ts`) has strong unit tests (11 scenarios)
and the interactive tools have strong unit tests. But no test verifies that
interactive events (callbacks from confirm/choose/send_choice) flow correctly
through the temporal queue's batch semantics.

Key questions untested:

- Callbacks are lightweight events. If a callback arrives between two text
  messages, does `dequeueBatch` correctly include it in the first batch?
- If a voice message is pending transcription and a callback arrives after it,
  does the batch hold correctly (voice holds entire batch)?
- Non-blocking `send_choice` callbacks that bypass hooks — do they appear as
  standalone lightweight batches?

## Test Scenarios

### SC-1: Callback between text messages

1. Enqueue: `[text₁, callback₁, text₂]`
2. `dequeueBatch` → `[text₁]` (text is heavyweight delimiter)
3. `dequeueBatch` → `[callback₁, text₂]` (callback lightweight + text
   delimiter)
4. `dequeueBatch` → empty

### SC-2: Callback after pending voice

1. Enqueue: `[reaction₁, voice(pending), callback₂]`
2. `dequeueBatch` → held (voice not ready)
3. Mark voice ready
4. `dequeueBatch` → `[reaction₁, voice]`
5. `dequeueBatch` → `[callback₂]`

### SC-3: Only callbacks (lightweight-only batch)

1. Enqueue: `[callback₁, callback₂, callback₃]`
2. `dequeueBatch` → `[callback₁, callback₂, callback₃]` (all lightweight,
   drain everything)

### SC-4: Interactive hook intercepts before queue

1. Register callback hook for `message_id` X
2. Simulate `callback_query` for `message_id` X via `recordInbound`
3. Verify hook fires inline (never reaches queue)
4. Verify `dequeueBatch` does NOT contain the callback

### SC-5: Unhooked callback enters queue

1. Do NOT register any callback hook
2. Simulate `callback_query` via `recordInbound`
3. Verify callback IS enqueued to session queue
4. Verify `dequeueBatch` returns it as lightweight event

## Code References

- `src/temporal-queue.ts` — `dequeueBatch`, `isHeavyweight`
- `src/session-queue.ts` — `isHeavyweightEvent`, `createSessionQueue`
- `src/message-store.ts` — `recordInbound`, `_callbackHooks`
- `src/two-lane-queue.test.ts` — existing temporal queue unit tests

## Constraints

- Test file: `src/temporal-queue-interactive.test.ts` or extend existing
  `src/two-lane-queue.test.ts`
- Use real `TemporalQueue` instances, mock Telegram API
- Each scenario independent
- Test file only — no production code changes
