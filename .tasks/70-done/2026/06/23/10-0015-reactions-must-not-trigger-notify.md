# 10-0015 — Reactions must not trigger SSE notify/wake signal

**Status**: queued  
**Filed by**: Overseer (2026-06-23)  
**Source**: Operator observation — reaction woke idle agent; Overseer code audit confirmed root cause  

---

## Problem

When an operator adds a reaction to a message, the bridge fires an SSE `notify` event, waking the agent. This is wrong. Reactions should be **dequeued** (they appear in dequeue batches) but should **not** cause an agent wake signal.

Observed: operator added a reaction while Overseer was idle → Overseer woke and started a turn.

---

## Root Cause

`isEventReady()` in `src/session-queue.ts` (line 32–35):

```typescript
function isEventReady(event: TimelineEvent): boolean {
  const c = event.content;
  return !(c.type === "voice" && c.text === undefined);
}
```

Returns `true` for all events except pending-transcription voice — including reactions.

In `enqueueToSession()` (line 324–328) and the broadcast loop (line 283–284), `notifySession()` is called whenever `isEventReady()` returns true. So reactions unconditionally trigger `notifySession()` → SSE fires → agent wakes.

---

## Acceptance Criteria

- **AC-1**: A user reaction to any bot message does NOT fire an SSE notify event to the session that owns that message.
- **AC-2**: Reactions still appear in dequeue batches (they must still be enqueued — only the wake is suppressed).
- **AC-3**: Self-reactions (bot reacting to its own messages) remain unaffected — these already have the AC-1 self-notify filter in `notifySession()`.
- **AC-4**: All existing notify tests continue to pass. Add at least one test asserting reaction → no notify.

---

## Proposed Fix

Do NOT modify `isEventReady()` — it controls batch drainability in `TemporalQueue` and must return true for reactions so they appear in dequeue output.

Instead, introduce a separate predicate controlling the wake signal:

```typescript
/** Returns true if this event should wake a parked agent (fire SSE notify). */
function isNotifyTriggerEvent(event: TimelineEvent): boolean {
  return event.event !== "reaction";
}
```

Then replace all `if (isEventReady(event))` guards around `notifySession()` calls with:

```typescript
if (isEventReady(event) && isNotifyTriggerEvent(event))
```

Specifically, the two call sites in `enqueueToSession` (line 324) and the broadcast loop (line 283).

---

## Files in scope

- `src/session-queue.ts` — add `isNotifyTriggerEvent`, update two call sites
- `src/session-queue.test.ts` (or equivalent) — add AC-4 regression test

---

## Out of scope

- Callback/button events: leave as-is for now (separate question whether they should wake)
- Dequeue filtering: reactions remain in batches as-is

---

## Notes

- This is a **notification policy** fix, not a debounce/gate fix
- Reactions reaching the notify path is a pre-existing gap not addressed in v7.13.0
- Curator was consulted; Overseer code audit overrides prior position

---

## Verification

**Verdict**: APPROVED  
**Verifier**: a6ed4006b51c75094 (2026-06-23)  
**Squash commit**: dc53798 on `release/7.14.0`  
**PR**: https://github.com/electrified-cortex/Telegram-Bridge-MCP/pull/233  
**Test results**: 3878/3878 pass (build exit 0, test exit 0)  

All four ACs confirmed:
- AC-1: `isNotifyTriggerEvent()` returns false for reactions; both `notifySession()` call sites gated. ✓
- AC-2: `q.enqueue(event)` called unconditionally before notify guard; reactions enqueue normally. ✓  
- AC-3: Self-reactions remain doubly suppressed; existing test unmodified and passing. ✓  
- AC-4: New test at session-queue.test.ts:701–715 asserts SSE NOT fired; reaction pendingCount=1. ✓  

**Sealed-By**: foreman (2026-06-23)
