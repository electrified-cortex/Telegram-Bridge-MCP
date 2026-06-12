# Simplify Outbound to Governor-Only

**Type:** Refactor
**Priority:** 100 (High)

## Description

The `subscribe_outbound` / `unsubscribe_outbound` tools add unnecessary complexity. Replace with a simpler model: outbound forwarding goes to the **governor only**, automatically. No tools needed, no opt-in/opt-out.

## What to Remove

- `src/tools/subscribe_outbound.ts` — delete file
- `src/tools/subscribe_outbound.test.ts` — delete file
- `src/tools/unsubscribe_outbound.ts` — delete file
- Tool registrations in `src/server.ts`
- `subscribeOutbound()`, `unsubscribeOutbound()`, `isOutboundSubscribed()` from `src/session-queue.ts`
- `_outboundSubscriptions` Set from `src/session-queue.ts`
- Any test code that calls `subscribeOutbound()` explicitly

## What to Change

**`src/session-queue.ts` — `broadcastOutbound()`:**

```typescript
export function broadcastOutbound(event: TimelineEvent, senderSid: number): void {
  const govSid = getGovernorSid();
  if (govSid <= 0 || govSid === senderSid) return;
  const q = _queues.get(govSid);
  if (q) q.enqueue(event);
}
```

Governor gets all outbound automatically. No subscription needed. If the governor needs to forward something to a worker, it uses `send_direct_message`.

**`docs/multi-session.md`:** Update the outbound broadcast section to describe governor-only forwarding. Keep a note that per-session opt-in was considered and deferred.

**`docs/behavior.md`:** Update the outbound broadcast subsection if it references subscribe/unsubscribe.

## Acceptance Criteria

- [x] `subscribe_outbound.ts` and `unsubscribe_outbound.ts` deleted
- [x] `broadcastOutbound()` forwards only to governor
- [x] No `_outboundSubscriptions` Set remains
- [x] Tests updated — remove subscribe/unsubscribe tests, add governor-only forwarding tests
- [x] `removeSessionQueue` no longer references subscriptions
- [x] `resetSessionQueuesForTest` no longer references subscriptions
- [x] Docs updated
- [x] Build passes, lint clean, all tests pass
- [x] `changelog/unreleased.md` updated

## Completion

### Changes Made

**Deleted files:**

- `src/tools/subscribe_outbound.ts`
- `src/tools/subscribe_outbound.test.ts`
- `src/tools/unsubscribe_outbound.ts`

**`src/session-queue.ts`:**

- Removed `_outboundSubscriptions` Set
- Removed `subscribeOutbound()`, `unsubscribeOutbound()`, `isOutboundSubscribed()` exports
- Removed `_outboundSubscriptions.delete(sid)` from `removeSessionQueue()`
- Removed `_outboundSubscriptions.clear()` from `resetSessionQueuesForTest()`
- Rewrote `broadcastOutbound()`: now forwards only to the governor session using `getGovernorSid()`; no-ops if no governor or if sender is the governor

**`src/session-queue.test.ts`:**

- Removed `subscribeOutbound`, `unsubscribeOutbound`, `isOutboundSubscribed` imports
- Deleted "broadcastOutbound" subscription-based tests (6 tests)
- Deleted "outbound subscription" describe block (4 tests)
- Added new "broadcastOutbound" describe block with 6 governor-only tests: forwards to governor, no governor no-op, sender-is-governor no-op, no sessions, wakes governor waiter, governor queue missing no-op

**`src/multi-session.integration.test.ts`:**

- Removed `subscribeOutbound` import
- Rewrote "cross-session broadcast" describe: replaced subscription-based tests with 3 governor-only tests
- Updated "combined scenarios" test: broadcastOutbound now uses `setGovernorSid` instead of `subscribeOutbound`
- Updated "edge cases": "broadcast wakes governor queue waiter" replaces old subscription-based waiter test

**`src/server.ts`:**

- Removed `registerSubscribeOutbound`/`registerUnsubscribeOutbound` imports and call sites

**`docs/multi-session.md`:**

- Updated "Outbound Visibility" section — describes governor-only forwarding
- Replaced "Outbound Broadcast Opt-in" section with "Outbound Forwarding (Governor-Only)"
- Updated Swarm Model bullet
- Updated Permissions section anchor link
- Updated Cross-Session table

**`docs/behavior.md`:**

- Replaced "Outbound broadcast opt-in" subsection with "Outbound forwarding (governor-only)"

### Test Results

1474 tests, 78 files — all pass. Lint clean. Build clean.
