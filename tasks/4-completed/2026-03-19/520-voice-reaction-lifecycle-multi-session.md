# 520 — Voice reaction lifecycle broken in multi-session

**Priority:** 200 (High)
**Scope:** `src/poller.ts`

## Problem

Operator reports: voice messages show ✍ (transcribing) but never transition to 😴 (queued). The expected lifecycle is:

1. ✍ — transcribing (set by poller)
2. 😴 — queued, waiting for agent (set by poller after transcription)
3. 🫡 — acknowledged by agent (set by dequeue_update on receipt)

In multi-session mode, the ✍ → 😴 transition appears broken. The 🫡 fires on dequeue, but 😴 never appears for messages that aren't immediately consumed.

## Likely cause

In `_transcribeAndRecord()` (poller.ts ~L270), after transcription the code checks:
```ts
if (!waiterWaiting && !isMessageConsumed(messageId) && !isSessionMessageConsumed(messageId))
```

`hasAnySessionWaiter()` returns true when ANY session has a waiter blocked in `dequeue_update` — so if the Overseer is waiting in its dequeue loop, the condition `!waiterWaiting` is false and 😴 is never set. But the Overseer's waiter doesn't mean this message will be immediately consumed — it might be routed to a different session, or the Overseer might process it after a delay.

The check was designed for single-session mode where one waiter = immediate consumption. In multi-session, a waiter on session A doesn't mean session B's message will be consumed promptly.

## Completion

**Status:** Done — 1483/1483 tests pass, build clean.

**Root cause confirmed:** `hasAnySessionWaiter()` iterates all session queues; in multi-session the governor is always blocking in `dequeue_update`, so it always returned true, suppressing 😴 for every voice message.

**Fix:**
- `TemporalQueue` gains `private readonly _pendingIds = new Set<number>()` — maintained in `enqueue()` (with eviction handling) and `_trackConsumed()`; exposes `hasItem(id): boolean` for O(1) lookup.
- `session-queue.ts` new export `hasSessionWaiterForMessage(messageId)` — iterates queues, returns true only when the queue *holding this message* (`q.hasItem(messageId)`) also has an active waiter (`q.hasPendingWaiters()`).
- `poller.ts` import and call site updated: `hasAnySessionWaiter` → `hasSessionWaiterForMessage(messageId)`.
- `poller.test.ts` mock renamed; existing "skips 😴" test title clarified; new regression test added: "sets 😴 when governor has a waiter but voice message is in worker's session queue".

**Changelog:** Added to `changelog/unreleased.md` under Fixed.
