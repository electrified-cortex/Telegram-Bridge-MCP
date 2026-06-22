# Fix: reactions do not wake SSE subscribers

**Priority:** 20
**Source:** Backlog audit 2026-06-22
**Repo:** electrified-cortex/Telegram-Bridge-MCP

## Problem

When a user sends a reaction (emoji reaction to a message), the reaction is queued in `routeToSession()` but `notifySession()` is **not called**. The SSE subscriber is not woken. The reaction sits in the queue until the agent's next dequeue timeout fires (up to 90–300 seconds later).

Confirmed gap at `src/session-queue.ts`:

```typescript
// Line 297 (broadcast path)
if (isEventReady(event) && event.event !== "reaction") {
  notifySession(sid, "operator", isDequeueActive(sid), broadcastOriginatorSid);
}

// Line 338 (targeted path)
if (isEventReady(event) && event.event !== "reaction") {
  notifySession(sid, ...);
}
```

The `&& event.event !== "reaction"` guard was presumably added intentionally (reactions are low-priority), but the effect is that agents are unresponsive to reactions until their dequeue loop cycles. This contradicts the expected behavior: reactions should wake the agent promptly.

## Scope

`src/session-queue.ts` — remove the `&& event.event !== "reaction"` guard from both notify calls (lines ~297 and ~338).

**Before:**
```typescript
if (isEventReady(event) && event.event !== "reaction") {
  notifySession(...)
}
```

**After:**
```typescript
if (isEventReady(event)) {
  notifySession(...)
}
```

If there was a design reason to suppress reaction wakes, add a profile flag (`suppress_reaction_notify: boolean`) rather than a hard exclusion. But the default should be: reactions wake the SSE.

## Acceptance Criteria

- AC1: After the fix, a user sending a reaction to any message causes an SSE `data: notify` event to be delivered to the session's SSE subscriber within the normal notify latency window.
- AC2: The two `&& event.event !== "reaction"` guards in `src/session-queue.ts` are removed (or replaced with a profile-configurable flag defaulting to `false`).
- AC3: Existing tests pass (`pnpm test` exits with no new failures).
- AC4: A new test covers the reaction-notify path: given a reaction event routed to a session, `notifySession` is called (or SSE stream receives `data: notify`).
- AC5: Build passes (`pnpm build` exits 0).

## Delegation

- **Executor:** TMCP foreman → worker
- **Repo:** electrified-cortex/Telegram-Bridge-MCP
- **File:** `src/session-queue.ts` (lines ~297, ~338)

## Open question for implementer

Was the reaction exclusion intentional to avoid notify spam (e.g. bulk reactions)? If so, consider a debounce rather than full suppression. Surface this in the PR description.

## Overseer stamp

**Reviewer:** Overseer | **Date:** 2026-06-22 | **Verdict:** PASS ✅
ACs binary + testable, scope bounded (1 file, 2 guard removals), delegation correct. Open question noted for implementer — does not block execution.
