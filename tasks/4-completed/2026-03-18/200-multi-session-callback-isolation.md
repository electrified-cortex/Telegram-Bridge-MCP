# Feature: Multi-Session Callback Isolation Tests

## Type

Testing

## Priority

200 (medium — important for multi-session correctness)

## Problem

The multi-session integration tests verify queue isolation, SID enforcement,
voice ack, and routing. But they never test interactive button flows across
sessions:

- SID 1 sends a `confirm` → user clicks → does the callback route to SID 1's
  queue?
- SID 1 sends buttons, SID 2 also sends buttons → callbacks for each route to
  the correct session?
- Session closes while buttons are live → what happens to pending callbacks?

Callback hooks are registered globally in `_callbackHooks` (keyed by
`message_id`). The hook fires inline during `recordInbound` **before** any
queue routing. This means the hook owner (the session that sent the buttons)
handles the callback regardless of routing mode. After the hook fires, the
event still routes to session queues via `routeToSession`.

## Key Facts (from source)

- **`_callbackHooks`** is a `Map<number, CallbackHookFn>` in
  `src/message-store.ts`. Keyed by `message_id`.
- **`_callbackHookOwners`** is a `Map<number, number>` tracking which SID
  registered each hook (for teardown on session close).
- **Hook interception order** (`recordInbound`): create event → push to
  timeline → check `_callbackHooks.get(targetId)` → fire hook (one-shot,
  deleted after call) → then route to session queues.
- **Session close cleans up hooks**: `close_session.ts` calls
  `replaceSessionCallbackHooks(sid, replacement)` which replaces all hooks
  owned by the closing session with a replacement that answers "Session closed"
  and removes the inline keyboard.
- **Governor setup in tests**: use `vi.mock("./routing-mode.js")` and
  `mocks.getGovernorSid.mockReturnValue(sid)` — see `src/health-check.test.ts`
  for the pattern.

## Test Scenarios

### SC-1: Callback routes to sending session's hook

1. Create SID 1 and SID 2 via `createSession`
2. SID 1 calls `confirm` → hook registered for `message_id` X in
   `_callbackHooks` with owner SID 1 in `_callbackHookOwners`
3. Simulate `callback_query` for `message_id` X via `recordInbound`
4. Verify SID 1's hook fires (one-shot — hook deleted from map after call)
5. Verify `_callbackHooks.has(X)` is `false` after firing

### SC-2: Concurrent buttons — independent hooks

1. SID 1 calls `confirm` → hook for `message_id` 100
2. SID 2 calls `choose` → hook for `message_id` 200
3. Simulate `callback_query` for `message_id` 200 → verify SID 2's hook fires
4. Verify SID 1's hook for `message_id` 100 is still registered (untouched)
5. Simulate `callback_query` for `message_id` 100 → verify SID 1's hook fires

### SC-3: Session close replaces hooks with "Session closed" handler

1. SID 1 calls `confirm` → hook for `message_id` X registered
2. Close SID 1 via `close_session` tool
3. Verify `replaceSessionCallbackHooks` was called with SID 1
4. Simulate `callback_query` for `message_id` X
5. Verify the replacement hook fires — calls `answerCallbackQuery` with
   "Session closed" text and removes the inline keyboard
6. Verify no crash

### SC-4: Governor routing then button callback

Set up governor routing via the mock pattern from `health-check.test.ts`:

1. Mock `getGovernorSid` to return SID 1 (governor)
2. Mock `setRoutingMode("governor")` — or set it directly
3. Create SID 2
4. Route an incoming text message — governor decides to route to SID 2
5. SID 2 calls `confirm` → hook registered for `message_id` Y
6. Simulate `callback_query` for `message_id` Y
7. Verify SID 2's hook fires (hooks are keyed by `message_id`, not by routing)
8. Verify governor's session queue does NOT contain the callback event

## Code References

- `src/message-store.ts` — `_callbackHooks`, `_callbackHookOwners`,
  `recordInbound` (lines 283–299), `replaceSessionCallbackHooks` (lines
  730–740)
- `src/session-queue.ts` — `routeToSession`, per-session queues
- `src/session-manager.ts` — `closeSession` (does NOT clean hooks — that's
  done at the tool layer)
- `src/tools/close_session.ts` — calls `replaceSessionCallbackHooks` (line
  116)
- `src/tools/confirm.ts`, `src/tools/choose.ts`
- `src/multi-session.integration.test.ts` — existing integration test patterns
- `src/health-check.test.ts` — governor mock pattern

## Completion Report

**Status:** Done — all 4 tests pass.

**Test file:** `src/multi-session-callbacks.test.ts` (4 new tests)

**Test count delta:** 1446 → 1450

**What was implemented:**

- SC-1: Verified callback hooks fire exactly once for the sending session when 2 sessions
  are active; second click for the same message is a no-op (one-shot hook).
- SC-2: SID 1's `confirm` and SID 2's `choose` run concurrently; each callback routes
  to the correct hook independent of the other.
- SC-3: `close_session` replaces SID 1's in-flight hook with a graceful "Session closed"
  handler that calls `answerCallbackQuery` with text and clears the inline keyboard.
- SC-4: Governor routing does not cause the governor's queue to receive callback events
  that belong to another session's message (hook fires by `message_id` owner, not routing).

**No production code changes** — this was a pure testing task. The existing callback
hook infrastructure (`_callbackHooks`, `_callbackHookOwners`, `replaceSessionCallbackHooks`)
already handled all scenarios correctly.

**Key pattern documented:** `identity: [sid, pin]` is required for interactive tools
(`confirm`, `choose`) when `activeSessionCount() > 1`. Tests must pass this explicitly.
`trackMessageOwner(msgId, sid)` must be called manually in tests since the outbound proxy
is not active in the test environment.

## Acceptance Criteria

- [ ] All 4 scenarios pass
- [ ] Each test is independent (no shared state)
- [ ] `pnpm test` — all pass
- [ ] `pnpm lint` — zero errors
- [ ] `pnpm build` — compiles clean

## Constraints

- Test file: `src/multi-session-callbacks.test.ts` (at `src/` root, matching
  the existing `src/multi-session.integration.test.ts` convention)
- Mock Telegram API, use real session queues and hooks
- Test file only — no production code changes
