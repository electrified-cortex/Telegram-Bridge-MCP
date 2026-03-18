# Feature: Replace Two-Lane Queue with Temporal Ordered Queue

## Type

Feature — Core Queue Redesign

## Priority

100 (high — changes fundamental delivery semantics)

## Origin

Operator voice discussion (2026-03-18):
> "The batch would be like reaction, reaction, reaction, something, and then direct message. That is a batch. Nothing before that. Nothing after it. Just up to that point."
> "A callback happened NOW. It goes into the timeline at the current position, not at the position of the original message."
> "If the voice message has been received, you wait until the transcription is finished before sending."

## Problem

The current `TwoLaneQueue` separates events into two independent lanes:
- **Response lane**: reactions, callbacks — drained fully on each batch
- **Message lane**: text, voice, media — one per batch

This breaks temporal ordering. If the user sends reactions AFTER a text message
the agent hasn't read yet, those reactions arrive in the current batch before the
text message. The agent misinterprets context — e.g., a thumbs-down on message 20
arrives before message 15 which says "stop doing that."

### Why the Two-Lane Queue Existed

It was created opportunistically to solve callback priority — ensuring button
presses weren't stuck behind queued text messages. However, interactive callbacks
(`confirm`, `choose`, `ask`) already bypass the queue entirely via inline
callback hooks (`_callbackHooks` in `message-store.ts`). The hooks fire during
`recordInbound`, before any queue routing. So the priority problem the two-lane
design tried to solve was already handled at a lower layer.

## Correct Model: Temporal Stream with Message Delimiters

### Rules

1. **Single ordered queue** per session. Events are enqueued in arrival order.
2. **Event classification**: each event is either *lightweight* (reaction,
   callback query, file, service message) or *heavyweight* (text message, voice
   message).
3. **Batch boundary**: `dequeueBatch` scans forward in temporal order. Collects
   all events. Stops at the first heavyweight event (inclusive). That heavyweight
   event is part of the batch. Everything after it stays queued.
4. **Voice hold**: if the delimiter is a voice message and transcription is not
   yet complete, the **entire batch is held**. Nothing is released. When
   transcription completes, the batch is released on the next `dequeueBatch`
   call.
5. **Lightweight-only batch**: if the queue has only lightweight events and no
   heavyweight delimiter, drain all of them — they're a complete batch.
6. **Callback hooks unchanged**: `confirm`, `choose`, `ask` fire inline via
   `_callbackHooks` and never depend on queue delivery order.

### Batch Examples

Given a temporal queue: `[reaction₁, reaction₂, text_msg, reaction₃, voice_msg]`

- **First `dequeueBatch`**: `[reaction₁, reaction₂, text_msg]` — stops at first
  heavyweight
- **Second `dequeueBatch`**: `[reaction₃, voice_msg]` — voice is the delimiter;
  if transcription pending, batch is held until ready
- **Third `dequeueBatch`**: `[]` — empty

Given: `[reaction₁, callback₂, reaction₃]` (no heavyweights)

- **First `dequeueBatch`**: `[reaction₁, callback₂, reaction₃]` — all
  lightweight, drain everything

Given: `[reaction₁, voice_msg(pending), callback₂]`

- **First `dequeueBatch`**: held — voice is the delimiter but not ready. Nothing
  released.
- After transcription completes:
- **First `dequeueBatch`**: `[reaction₁, voice_msg]` — voice is the delimiter
- **Second `dequeueBatch`**: `[callback₂]` — remaining lightweight

### Button Press Semantics

When a user scrolls up and presses a button from 20 messages ago, the callback
event is timestamped NOW. It enters the queue at the current position. It is NOT
retroactively placed at the position of the original message. It is semantically
identical to the user sending a new message at that moment — a lightweight event
in the temporal stream.

## Implementation

### Files to Change

- `src/two-lane-queue.ts` → rename/replace with `src/temporal-queue.ts`
  - Single internal `Queue<T>` instead of two lanes
  - `isHeavyweight(item: T) → boolean` predicate (injectable, like `isReady`)
  - `dequeueBatch()`: scan forward, collect up to and including first
    heavyweight; hold if heavyweight not ready
  - Keep: `_consumedIds`, `_waiters`, `pendingCount()`, `isConsumed()`,
    `hasPendingWaiters()`, `waitForEnqueue()`, `dequeueMatch()`
  - Keep: `enqueue(item, lane?)` — classification by caller is fine, but storage
    is a single queue
- `src/session-queue.ts` → update to use new queue type
- `src/message-store.ts` → update global queue usage
- `src/tools/dequeue_update.ts` → no changes expected (already calls
  `dequeueBatch()`)

### Test Scenarios

Each of these MUST have a dedicated test:

1. **Reactions then text**: `[R, R, R, T]` → batch `[R, R, R, T]`
2. **Text then reactions**: `[T, R, R]` → batch `[T]`, then `[R, R]`
3. **Multiple texts**: `[T₁, T₂, T₃]` → batch `[T₁]`, then `[T₂]`, then
   `[T₃]`
4. **Reactions between texts**: `[R₁, T₁, R₂, T₂]` → batch `[R₁, T₁]`, then
   `[R₂, T₂]`
5. **Voice pending transcription**: `[R, V(pending)]` → held, then after
   transcript → `[R, V]`
6. **Voice blocks later events**: `[R, V(pending), R₂]` → held; after
   transcript → `[R, V]`, then `[R₂]`
7. **All lightweight (no heavy)**: `[R₁, C, R₂]` → batch `[R₁, C, R₂]`
8. **Callback from old button**: callback timestamped now → enters at current
   position, not original message position
9. **Empty queue**: `[]` → `[]`
10. **Single heavyweight**: `[T]` → `[T]`
11. **Voice ready immediately**: `[R, V(ready)]` → `[R, V]` — no hold

### Migration

- `TwoLaneQueue` is used in `session-queue.ts` (per-session) and
  `message-store.ts` (global fallback). Both need updating.
- The `enqueueResponse` / `enqueueMessage` API should become a single `enqueue`
  with an optional classification flag, or the queue auto-classifies via the
  `isHeavyweight` predicate.
- All existing tests for `TwoLaneQueue` in `src/two-lane-queue.test.ts` (if any)
  need rewriting to match the new semantics.

## Acceptance Criteria

- [ ] `TwoLaneQueue` replaced with temporal ordered queue
- [ ] `dequeueBatch` respects temporal order with heavyweight delimiters
- [ ] Voice messages hold the entire batch until transcription completes
- [ ] All 11 test scenarios pass
- [ ] Callback hooks (`_callbackHooks`) still fire inline — unaffected
- [ ] `pending` count remains accurate
- [ ] No regressions in existing integration tests
