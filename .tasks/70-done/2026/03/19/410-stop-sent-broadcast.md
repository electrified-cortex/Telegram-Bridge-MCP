# 410 — Stop broadcasting "sent" events to the governor

## Problem

When any session sends a message (`send_text`, `notify`, etc.), the outbound proxy records a `"sent"` event and `broadcastOutbound()` delivers it to the **governor's** session queue. This means the governor sees every other session's outgoing chat messages in its `dequeue_update` stream.

The governor's only special ability should be **receiving ambiguous messages**. Broadcasting "sent" events to the governor is an unintended extra power.

## Root Cause

`src/session-queue.ts`, function `broadcastOutbound()` (line ~216):

```ts
export function broadcastOutbound(event: TimelineEvent, senderSid: number): void {
  const govSid = getGovernorSid();
  if (govSid <= 0 || govSid === senderSid) return;
  const q = _queues.get(govSid);
  if (q) q.enqueue(event);
}
```

Called from `src/message-store.ts` `recordOutgoing()` (line ~466):
```ts
if (activeSid > 0) broadcastOutbound(evt, activeSid);
```

## Fix

Remove the `broadcastOutbound` call from `recordOutgoing()` in `src/message-store.ts`. The function itself can stay exported (it's tested), but it should no longer be invoked during normal outbound recording.

Alternatively, remove `broadcastOutbound` entirely if no other callers exist. Check for all call sites.

Also remove or update tests in `src/session-queue.test.ts` and `src/multi-session.integration.test.ts` that verify broadcast-to-governor behavior for "sent" events.

## Acceptance Criteria

- [x] Sessions do NOT receive other sessions' "sent" events in their dequeue stream
- [x] The governor still receives ambiguous messages (unrelated — verify not broken)
- [x] Direct messages between sessions still work
- [x] All tests pass (`npx vitest run`)
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/` clean

## Completion

**Completed:** 2026-03-19

Implemented by removing `broadcastOutbound(evt, activeSid)` from `recordOutgoing()` in `src/message-store.ts` and removing the unused `broadcastOutbound` import from that file.

Verification:
- `npx vitest run` passed (80 files, 1473 tests)
- `npx tsc --noEmit` passed
- `npx eslint src/` passed
