# 090 — Pending Guard Enrichment: Categorized Summary + Inline Guidance

**Priority:** 090
**Status:** Draft → Queue
**Created:** 2026-03-18

## Problem

When `confirm`, `ask`, or `choose` rejects with `PENDING_UPDATES`, the error only includes a count and generic boilerplate:

```json
{
  "code": "PENDING_UPDATES",
  "message": "3 unread update(s) in the queue. Drain them with dequeue_update(timeout:0) before calling confirm, or pass ignore_pending: true.",
  "pending": 3
}
```

The agent can't decide intelligently whether to drain or force through. Three reactions? Probably fine to force. Three text messages? Should definitely drain and read them first.

## Proposed Change

Enrich the error response with a **categorized summary** and **actionable guidance**:

```json
{
  "code": "PENDING_UPDATES",
  "pending": 5,
  "breakdown": { "text": 1, "voice": 1, "reaction": 3 },
  "message": "5 unread update(s): 1 text, 1 voice, 3 reactions. Consider draining remaining messages before asking. Pass ignore_pending: true to proceed anyway."
}
```

Key design points:

- **No full previews** — just counts by content type (text, voice, reaction, callback, service_message, etc.)
- **Inline guidance** — error message itself says what to do, so the agent doesn't need to look up docs
- **Existing `ignore_pending: true` flag** is the "force" mechanism — mention it explicitly in the message

## Implementation

### Step 1: Add `peekCategories()` to the queue

The session queue (`TemporalQueue`) has no non-destructive peek. Add a method that iterates the internal queue and returns counts by `content.type`:

```typescript
// In temporal-queue.ts or session-queue.ts
peekCategories(): Record<string, number>
// Returns e.g. { text: 1, voice: 1, reaction: 3 }
```

This needs read-only access to the `@tsdotnet/queue` internals. The `Queue` class should support `forEach` or `[Symbol.iterator]`.

### Step 2: Enrich the guard error

In `confirm.ts`, `ask.ts`, `choose.ts` — the guard currently calls `sq.pendingCount()`. After detecting pending > 0:

1. Call `sq.peekCategories()` (or a session-queue wrapper)
2. Build the breakdown and message string
3. Include both in the error response

### Fallback

If the session queue isn't available (legacy global path), just return the existing count-only format. The global `pendingCount()` from message-store doesn't have category access.

## Code Path

- `src/temporal-queue.ts` — add `peekCategories()` method
- `src/session-queue.ts` — expose category peek for session queues
- `src/tools/confirm.ts` — enrich guard error
- `src/tools/ask.ts` — enrich guard error
- `src/tools/choose.ts` — enrich guard error

## Acceptance Criteria

- [x] Guard error includes `breakdown` object with counts by content type
- [x] Guard error message includes human-readable summary and mentions `ignore_pending: true`
- [x] No queue items are consumed/removed by the categorization
- [x] Fallback: global pending path still works (count only, no breakdown)
- [x] Tests: verify breakdown shape for mixed pending items
- [x] Tests: verify message text includes category counts
- [x] Build clean, lint clean, all tests pass
- [x] `changelog/unreleased.md` updated

## Completion

**Date:** 2026-03-18

**Changes:**

- `src/temporal-queue.ts`: Added `peekCategories(getType)` — drains and re-enqueues items to count by type (non-destructive)
- `src/session-queue.ts`: Exported `peekSessionCategories(sid)` wrapping the above with `evt.content.type` extractor
- `src/tools/confirm.ts`, `ask.ts`, `choose.ts`: Imported `peekSessionCategories`; enriched `PENDING_UPDATES` guard with `breakdown` field and a detailed message string

**Tests added (3):** one per tool verifying `breakdown` shape, message content, and that `sendMessage` is not called.
