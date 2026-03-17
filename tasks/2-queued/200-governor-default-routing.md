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

- [ ] Default routing mode changes from `load_balance` to `governor` when 2+ sessions are active
- [ ] First session is automatically designated as governor (governor SID = first session's SID)
- [ ] Ambiguous messages (no reply-to) route only to governor session's queue
- [ ] Targeted messages (reply-to bot message) route to the owning session
- [ ] Governor close promotes next session or falls back to `load_balance`
- [ ] Single-session mode remains unaffected (no routing needed)
- [ ] `setRoutingMode` / `getRoutingMode` API unchanged (backward compat)
- [ ] Tests: auto-governor on second session join
- [ ] Tests: ambiguous message → governor only
- [ ] Tests: targeted message → correct session
- [ ] Tests: governor close → promotion or fallback
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`
