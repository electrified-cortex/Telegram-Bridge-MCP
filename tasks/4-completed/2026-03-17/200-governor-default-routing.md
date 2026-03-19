# Feature: Default to Governor Routing

## Type

Feature / Architecture

## Description

Round-robin (`load_balance`) routing is deprecated as the default. When 2+ sessions are active, the default routing mode should be `governor` — the Primary session gets all ambiguous messages and decides what to do with them. Reply-to context handles targeted routing naturally (message goes to the session that sent the original).

## User Quote

> "Round-robin is dead. Too confusing."

## Current State

`src/routing-mode.ts` already implements the three-mode system:

```typescript
export type RoutingMode = "load_balance" | "cascade" | "governor";
let _mode: RoutingMode = "load_balance";  // ← this default needs to change
let _governorSid = 0;
```

- `setRoutingMode(mode, governorSid?)` — sets mode and optional governor SID
- `getRoutingMode()` / `getGovernorSid()` — read current state
- `close_session.ts` (L35) — already resets to `load_balance` if the governor session closes

The routing mode state is **in-memory only** — resets on MCP restart.

## Code Path

1. `src/routing-mode.ts` — mode state, accessors, governor SID tracking
2. `src/session-queue.ts` — `routeMessage()` reads `getRoutingMode()` to decide which session queue gets an incoming message
3. `src/poller.ts` — calls into session-queue routing for each incoming update
4. `src/tools/session_start.ts` — when the first session starts and a second joins, this is where auto-governor could trigger
5. `src/tools/close_session.ts` — already handles governor teardown (L35): if closed SID === governor SID, resets to `load_balance`
6. `src/tools/route_message.ts` — manual rerouting by session-auth tools (governor uses this to dispatch)

## Design Decisions

### When does governor mode activate?

Automatically when `activeSessionCount()` goes from 1 → 2. The first session (Primary) becomes governor. No operator confirmation needed — this is the expected default.

### What is "ambiguous"?

A message with no reply-to context pointing to a known bot message. In practice:
- **Targeted:** user replies to a bot message → route to the session that sent that message
- **Ambiguous:** fresh user message, no reply → governor session gets it

### What does the governor do with ambiguous messages?

The governor session's agent decides:
- Handle it directly
- Use `route_message` to forward to another session
- Use `pass_message` if it's clearly for a specific session

### What if the governor session closes?

Already handled: `close_session.ts` resets to `load_balance`. But this task should change that to: promote the next-lowest SID to governor, or fall back to `load_balance` only if no sessions remain.

### What about cascade mode?

Deferred. Cascade and governor may merge later into a single "smart routing" approach. For now, only `governor` is the default.

## Acceptance Criteria

- [x] Default routing mode changes from `load_balance` to `governor` when 2+ sessions are active
- [x] First session is automatically designated as governor (governor SID = first session's SID)
- [x] Ambiguous messages (no reply-to) route only to governor session's queue
- [x] Targeted messages (reply-to bot message) route to the owning session
- [x] Governor close promotes next session or falls back to `load_balance`
- [x] Single-session mode remains unaffected (no routing needed)
- [x] `setRoutingMode` / `getRoutingMode` API unchanged (backward compat)
- [x] Tests: auto-governor on second session join
- [x] Tests: ambiguous message → governor only (existing session-queue tests cover this)
- [x] Tests: targeted message → correct session (existing session-queue tests cover this)
- [x] Tests: governor close → promotion or fallback
- [x] All tests pass: `pnpm test`
- [x] No new lint errors: `pnpm lint`
- [x] Build clean: `pnpm build`

## Completion

**Agent:** GitHub Copilot (worker session)
**Date:** 2026-03-17

### What Changed

- `src/tools/session_start.ts` — Added `setRoutingMode` import; when `sessionsActive === 2`,
  auto-activates governor mode by finding the lowest-SID session (the first/Primary session)
  from `listSessions()` and calling `setRoutingMode("governor", lowestSid)`. The
  `res.routing_mode` read is now placed AFTER the `setRoutingMode` call so it reflects
  the newly activated governor mode.
- `src/tools/close_session.ts` — Added `listSessions` import; replaced the simple
  "reset to load_balance" governor-close logic with promotion logic: if sessions remain,
  promotes the lowest remaining SID to governor; only falls back to `load_balance` when
  no sessions remain.
- `src/tools/session_start.test.ts` — Added `setRoutingMode` mock; added 5 new tests
  covering auto-governor activation on 2nd session join, no-op on 1st session, governor
  mode reflected in result, lowest-SID selection, and no activation on 3rd+ session.
- `src/tools/close_session.test.ts` — Added `listSessions` mock; added 5 new tests
  covering governor promotion with remaining sessions, load_balance fallback with no
  sessions, out-of-order SID promotion, named session label, and unnamed session label.
- `src/tools/multi-session-integration.test.ts` — Updated scenario 4 to reflect new
  promotion behavior: split into "promotes next-lowest SID when sessions remain" and
  "resets to load_balance when no sessions remain".

### Test Results

- Tests added: 10 new tests (5 in session_start.test.ts, 5 in close_session.test.ts)
- Integration test updated: 1 existing test replaced with 2 new tests (net +1)
- Total tests: 1357 (all passing)
- Coverage: all new code paths covered

### Findings

- The `session_start.ts` multi-session block was refactored slightly to call `listSessions()`
  once and reuse the result for both `fellow_sessions` and governor SID selection. This
  eliminates a redundant call.
- The integration test for scenario 4 previously tested "reset to load_balance" as the
  universal behavior; this was incorrect per the new spec. It now properly tests the
  two-branch behavior (promote vs. fall back).
- Cascade mode and governor mode co-exist without conflict. The `setRoutingMode` API is
  fully backward-compatible.

### Acceptance Criteria Status

- [x] Default routing mode changes from `load_balance` to `governor` when 2+ sessions are active
- [x] First session is automatically designated as governor (governor SID = first session's SID)
- [x] Ambiguous messages (no reply-to) route only to governor session's queue
- [x] Targeted messages (reply-to bot message) route to the owning session
- [x] Governor close promotes next session or falls back to `load_balance`
- [x] Single-session mode remains unaffected (no routing needed)
- [x] `setRoutingMode` / `getRoutingMode` API unchanged (backward compat)
- [x] Tests: auto-governor on second session join
- [x] Tests: ambiguous message → governor only
- [x] Tests: targeted message → correct session
- [x] Tests: governor close → promotion or fallback
- [x] All tests pass: `pnpm test`
- [x] No new lint errors: `pnpm lint`
- [x] Build clean: `pnpm build`
