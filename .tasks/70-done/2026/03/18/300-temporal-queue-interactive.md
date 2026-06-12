# Feature: Temporal Queue + Interactive Flow Integration

## Type

Testing

## Priority

300 (normal — validates queue + interaction interplay)

## Problem

The temporal queue (`temporal-queue.ts`) has strong unit tests (11 scenarios)
and the interactive tools have strong unit tests. But no test verifies that
interactive events (callbacks from `confirm`/`choose`/`send_choice`) flow
correctly through the temporal queue's batch semantics.

## Key Facts (from source)

### Batch semantics (`src/temporal-queue.ts` `dequeueBatch`)

The algorithm:

1. Drain all items from the internal queue
2. Find the **first** heavyweight item (index `heavyIdx`)
3. If heavyweight is not ready (voice pending transcription) → re-enqueue
   everything, return `[]`
4. `batchEnd = heavyIdx + 1` (inclusive of the heavyweight)
5. Return `items.slice(0, batchEnd)`, re-enqueue `items.slice(batchEnd)`
6. If no heavyweight exists, drain all (lightweight-only batch)

**Example**: `[text₁, callback₁, text₂]`

- `heavyIdx = 0` (text₁ is heavyweight)
- `batchEnd = 1`
- Batch 1: `[text₁]` — just the first heavyweight
- Remaining: `[callback₁, text₂]`
- Batch 2: `[callback₁, text₂]` — callback (lightweight) + text₂ (heavyweight
  delimiter)

### Heavyweight classification (`src/session-queue.ts`)

```typescript
function isHeavyweightEvent(event: TimelineEvent): boolean {
  return event.event === "message"
    && (event.content.type === "text" || event.content.type === "voice");
}
```

Callbacks (`event: "callback"`) and reactions (`event: "reaction"`) are
**lightweight**.

### Voice readiness (`src/session-queue.ts`)

```typescript
function isEventReady(event: TimelineEvent): boolean {
  const c = event.content;
  return !(c.type === "voice" && c.text === undefined);
}
```

A voice message is "not ready" when `content.type === "voice"` AND
`content.text === undefined`. To simulate transcription completing in a test,
set `content.text` to a string value on the event object.

### Hook interception vs. queue (`src/message-store.ts` `recordInbound`)

When a `callback_query` arrives:

1. Event is created and pushed to `_timeline`
2. `_callbackHooks.get(targetId)` is checked — if a hook exists, it fires
   (one-shot, deleted after call)
3. **After** the hook: event is still routed to session queues via
   `routeToSession`

So hooked callbacks fire inline AND enter the queue. Unhooked callbacks only
enter the queue.

### Event shapes for test construction

**Callback event:**

```typescript
const callbackEvt: TimelineEvent = {
  id: messageId,
  timestamp: new Date().toISOString(),
  event: "callback",
  from: "user",
  content: { type: "cb", data: "some_data", qid: "qid_123", target: messageId },
};
```

**Reaction event:**

```typescript
const reactionEvt: TimelineEvent = {
  id: messageId,
  timestamp: new Date().toISOString(),
  event: "reaction",
  from: "user",
  content: { type: "reaction", target: messageId, added: ["👍"], removed: [] },
};
```

**Text message event:**

```typescript
const textEvt: TimelineEvent = {
  id: msgId,
  timestamp: new Date().toISOString(),
  event: "message",
  from: "user",
  content: { type: "text", text: "hello" },
};
```

**Voice message (pending — not yet transcribed):**

```typescript
const voicePending: TimelineEvent = {
  id: msgId,
  timestamp: new Date().toISOString(),
  event: "message",
  from: "user",
  content: { type: "voice", text: undefined, file_id: "file_abc" },
};
```

**Voice message (ready — transcribed):**

```typescript
const voiceReady: TimelineEvent = {
  id: msgId,
  timestamp: new Date().toISOString(),
  event: "message",
  from: "user",
  content: { type: "voice", text: "transcribed text", file_id: "file_abc" },
};
```

## Test Approach

These tests operate at two levels:

- **SC-1 through SC-3**: Pure `TemporalQueue` unit tests. Construct a
  `TemporalQueue` directly using `createSessionQueue` (or manually with the
  predicates from `session-queue.ts`). Enqueue events directly. Call
  `dequeueBatch()`. No `recordInbound` needed.
- **SC-4 and SC-5**: Integration tests using `recordInbound` to verify hook
  interception vs. queue routing. These need the full `message-store` wiring.

## Test Scenarios

### SC-1: Callback between text messages (pure queue)

1. Create a `TemporalQueue` with `isHeavyweightEvent` and `isEventReady`
   predicates
2. Enqueue in order: `textEvt₁`, `callbackEvt₁`, `textEvt₂`
3. `dequeueBatch()` → returns `[textEvt₁]` (stops at first heavyweight,
   inclusive)
4. `dequeueBatch()` → returns `[callbackEvt₁, textEvt₂]` (callback is
   lightweight, text₂ is the delimiter)
5. `dequeueBatch()` → returns `[]` (empty)

### SC-2: Callback after pending voice (pure queue)

1. Enqueue: `reactionEvt₁`, `voicePending`, `callbackEvt₂`
2. `dequeueBatch()` → returns `[]` (voice is the heavyweight delimiter but not
   ready — entire batch held)
3. Set `voicePending.content.text = "transcribed"` (simulate transcription)
4. `dequeueBatch()` → returns `[reactionEvt₁, voicePending]` (reaction +
   voice delimiter, now ready)
5. `dequeueBatch()` → returns `[callbackEvt₂]` (remaining lightweight, no
   heavyweight → drain all)

### SC-3: Only callbacks — lightweight-only batch (pure queue)

1. Enqueue: `callbackEvt₁`, `callbackEvt₂`, `callbackEvt₃`
2. `dequeueBatch()` → returns all three (no heavyweight → drain everything)

### SC-4: Hooked callback — hook fires but event still enters queue

1. Register a callback hook for `message_id` X in `_callbackHooks`
2. Simulate `callback_query` for `message_id` X via `recordInbound`
3. Verify the hook was called (one-shot)
4. Verify `_callbackHooks.has(X)` is `false` (deleted after firing)
5. Verify the callback event **also** routed to the session queue (both happen)
6. `dequeueBatch()` → returns the callback event

### SC-5: Unhooked callback enters queue directly

1. Do NOT register any callback hook for `message_id` Y
2. Simulate `callback_query` for `message_id` Y via `recordInbound`
3. Verify no hook fired (nothing to fire)
4. Verify callback IS in the session queue
5. `dequeueBatch()` → returns the callback event as a lightweight item

## Code References

- `src/temporal-queue.ts` — `dequeueBatch` (line 106), `enqueue`
- `src/session-queue.ts` — `isHeavyweightEvent`, `isEventReady`,
  `createSessionQueue`
- `src/message-store.ts` — `recordInbound` (lines 283–299), `_callbackHooks`,
  `TimelineEvent` interface (lines 31–75)
- `src/two-lane-queue.test.ts` — existing temporal queue unit test patterns

## Acceptance Criteria

- [ ] All 5 scenarios pass
- [ ] Each test is independent (no shared state)
- [ ] `pnpm test` — all pass
- [ ] `pnpm lint` — zero errors
- [ ] `pnpm build` — compiles clean

## Constraints

- Test file: extend `src/two-lane-queue.test.ts` (which already tests
  `TemporalQueue`) with a new `describe` block for interactive event
  scenarios, OR create `src/temporal-queue-interactive.test.ts`
- SC-1/SC-2/SC-3: use `TemporalQueue` directly with the predicates
- SC-4/SC-5: use `recordInbound` with session queue setup
- Test file only — no production code changes

## Completion

**Status:** Done — all 5 tests pass.

**Test file:** `src/temporal-queue-interactive.test.ts` (5 new tests, new file)

**Test count delta:** 1456 → 1461

**What was implemented:**

- SC-1: Callback event between two text messages — first `dequeueBatch()` returns `[text₁]`,
  second returns `[callback₁, text₂]`, third returns `[]`.
- SC-2: Pending voice holds the entire batch until `content.text` is set (transcription
  simulated by mutating the event object in-place). After release, batch 1 is
  `[reaction, voice]`, batch 2 is `[callback]` (lightweight-only drain).
- SC-3: Queue of only lightweight callbacks drains in one batch.
- SC-4: `registerCallbackHook` + `recordInbound` — hook fires once (one-shot), does
  not fire on a second `recordInbound` for the same message_id, and the callback event
  still routes to the session queue and appears in `dequeueBatch()`.
- SC-5: No hook registered — callback routes directly to session queue,
  `dequeueBatch()` returns the single event.

**No production code changes** — all batch semantics, hook interception, and queue
routing were already correct in `temporal-queue.ts`, `session-queue.ts`, and
`message-store.ts`.
