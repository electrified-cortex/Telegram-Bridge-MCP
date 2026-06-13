# Feature: Session Close Teardown Contract

## Type

Feature / Architecture

## Priority

200

## Status: COMPLETED 2026-03-17

## Implementation Summary

### Changes

**`src/message-store.ts`**
- Added `_callbackHookOwners: Map<number, number>` to track which session owns each callback hook
- `registerCallbackHook(messageId, fn, ownerSid?)` — optional 3rd arg stores owner; used by `confirm`, `choose`, `send_choice`
- `clearCallbackHook` now also removes from `_callbackHookOwners`
- `replaceSessionCallbackHooks(sid, replacement)` — replaces all hooks owned by `sid` with a substitution function; returns replaced message IDs
- `resetStoreForTest` clears `_callbackHookOwners`

**`src/session-queue.ts`**
- `drainQueue(sid)` — dequeues all pending events from the session's queue (without removing it), returns them for rerouting

**`src/tools/close_session.ts`**
- Imports `getSession` (to get name before closing), `drainQueue`, `routeToSession`, `replaceSessionCallbackHooks`
- Captures session name before `closeSession()` call
- Calls `drainQueue(sid)` before removing queue to collect orphaned events
- Always sends operator disconnect notification: "🤖 {name} has disconnected."
- After routing/notification logic: reroutes each orphaned event via `routeToSession` (routing lane depends on event type — `callback` → `response`, others → `message`)
- Replaces closed session's callback hooks with "Session closed" ack handlers (answer qid + remove keyboard)

**`src/tools/confirm.ts`, `src/tools/choose.ts`, `src/tools/send_choice.ts`**
- Pass `_sid` as `ownerSid` to `registerCallbackHook` so hooks are tracked per-session

### Tests Added/Updated

**`close_session.test.ts`** (+11 new tests, 2 updated)
- New mocks: `getSession`, `drainQueue`, `routeToSession`, `replaceSessionCallbackHooks`, `resolveChat`
- Tests: disconnect notification with session name, fallback "Session N" label, `undefined` session fallback
- Tests: orphaned event rerouting (message lane vs response/callback lane)
- Tests: no rerouting when no sessions remain, no rerouting when queue empty
- Tests: `replaceSessionCallbackHooks` called on every close, NOT called when close fails
- Updated: "does not reset routing" now expects 1 `sendServiceMessage` (disconnect notification)
- Updated: "does not reset routing or DM when 3 remain" now expects 1 `sendServiceMessage`

**`confirm.test.ts`, `choose.test.ts`, `send_choice.test.ts`**
- Updated `registerCallbackHook` call assertions to expect 3 arguments

**`multi-session-integration.test.ts`**
- Added `replaceSessionCallbackHooks: vi.fn(() => [])` to `message-store.js` mock

### Test Results

- 72 test files, 1397 tests — all passing ✅
- Lint: clean ✅
- Build: clean ✅

## Acceptance Criteria

- [x] Defined behavior for orphaned messages when a session closes
- [x] Operator notification on session close (always: "🤖 {name} has disconnected.")
- [x] Pending interaction cleanup (callbacks replaced with "Session closed" ack)
- [x] Outbound proxy state cleanup (no explicit cleanup needed — falls away naturally)
- [x] All edge cases documented and tested
- [x] All tests pass: `pnpm test`



## Description

When a session closes (agent finishes, crashes, or is kicked), the server needs a defined cleanup contract. Currently `close_session` removes the session from the session manager and resets governor routing, but several questions are unanswered:

- What happens to messages already queued for the closed session?
- Does the operator get notified?
- Does the closing session's outbound proxy state get cleaned up?
- What about pending `choose`/`confirm`/`ask` interactions owned by that session?

## Current State

`close_session.ts` calls:

1. `closeSession(sid)` — removes from session manager
2. `removeSessionQueue(sid)` — removes per-session queue
3. Governor promotion if applicable (task 200, completed)
4. Returns `{ closed: true }`

Messages in the removed queue are silently dropped. No operator notification. No cleanup of pending interactions.

## Design Decisions

1. **Orphaned messages:** Reroute to the governor (or next lowest SID if no governor). If no sessions remain, leave in a dead-letter queue for the next session that joins.
2. **Operator notification:** Always. Send `🤖 {name} has disconnected.` to the chat. Not configurable — always good to know.
3. **Pending interactions:** Callbacks for `choose`/`confirm`/`ask` owned by the closed session become no-ops. If the operator presses a button, answer the callback query with "Session closed" and dismiss. Don't error.
4. **Outbound proxy cleanup:** No explicit cleanup needed — proxy state is keyed by SID which is gone. The name-tag header builder (`buildHeader`) calls `getSession(sid)` which returns `undefined` for closed sessions, so the header naturally falls away.

## Code Path

1. `src/tools/close_session.ts` — After closing, call a new `teardownSession(sid)` in session-manager.
2. `src/session-manager.ts` — Add `teardownSession(sid)`: drain orphaned queue → reroute messages → send disconnect notification → clean up pending callbacks.
3. `src/session-queue.ts` — Add `drainQueue(sid): Update[]` — returns all pending messages before removing the queue.
4. `src/telegram.ts` — Send the disconnect notification message.
5. Callback handlers (confirm/choose/ask) — Check if owning session still exists; if not, answer callback with "Session closed".

## Acceptance Criteria

- [ ] Defined behavior for orphaned messages when a session closes
- [ ] Operator notification on session close (configurable severity)
- [ ] Pending interaction cleanup (callbacks, asks)
- [ ] Outbound proxy state cleanup
- [ ] All edge cases documented and tested
- [ ] All tests pass: `pnpm test`
