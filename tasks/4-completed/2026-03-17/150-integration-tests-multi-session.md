# Feature: Integration Tests for Multi-Session Workflows

## Type

Testing

## Description

Current tests mock individual functions but don't simulate real multi-session failure modes. Need integration-level tests that exercise the full path: session creation → message routing → dequeue → ack. The 2026-03-16 session exposed gaps where unit tests all passed but real multi-session usage broke (voice salute missing, queue isolation races).

## User Quote

> "Clearly we are not doing enough mock testing."
> "TDD all day."

## Dependencies

- Blocked by **100-sid-required-all-tools** — SID enforcement must exist before integration tests can verify it end-to-end

## Background

The multi-session architecture has three layers that need integration testing:

1. **Session lifecycle** — `session-manager.ts`: `createSession()` → `validateSession()` → `closeSession()`
2. **Message routing** — `session-queue.ts` + `routing-mode.ts`: incoming messages dispatched to per-session queues based on routing mode (`load_balance` / `cascade` / `governor`)
3. **Tool execution** — each tool resolves its session context via `sid` param, reads/writes through session-scoped state

Current unit tests mock at layer boundaries. Integration tests should wire layers together.

## Code Path

- `src/session-manager.ts` — session CRUD, `activeSessionCount()`, `getActiveSession()`/`setActiveSession()`
- `src/session-queue.ts` — per-session message queues, `getSessionQueue(sid)`, `dequeueBatch()`/`dequeueBatchAny()`
- `src/routing-mode.ts` — `getRoutingMode()`, `setRoutingMode()`, `getGovernorSid()`
- `src/tools/dequeue_update.ts` — `SID_REQUIRED` gate, `ackVoice()`, blocking wait vs immediate batch
- `src/tools/session_start.ts` — creates session, returns SID/PIN
- `src/tools/close_session.ts` — closes session, resets governor if closing governor SID
- `src/telegram.ts` — `ackVoiceMessage()`, `trySetMessageReaction()`, `getBotReaction()` dedup

## Test Scenarios

### 1. Two-session queue isolation

Create 2 sessions. Enqueue a message routed to SID 1. Dequeue from SID 2 — must get nothing. Dequeue from SID 1 — must get the message.

### 2. SID_REQUIRED enforcement across tools

Create 2 sessions. Call `dequeue_update` without `sid` — must get `SID_REQUIRED` error. Call `send_text` without `sid` — must get `SID_REQUIRED` error. (Depends on task 100 being complete.)

### 3. Voice ack through session queue path

Create a session. Enqueue a voice event into the session queue (not global). Dequeue via `dequeue_update(sid=1)`. Verify `ackVoiceMessage` is called for the voice event.

**Why this matters:** The global `dequeueBatch` path has ack coverage, but `sessionQueue.dequeueBatch()` is a separate code path that also feeds into the same ack loop. The 2026-03-16 bug may have been this path.

### 4. Session close cleans up routing

Create 2 sessions. Set routing mode to `governor` with SID 1 as governor. Close SID 1. Verify routing mode resets to `load_balance` and `getGovernorSid()` returns 0.

### 5. Rapid session create/close churn

Create and close sessions rapidly. Verify SID counter never reuses IDs, `activeSessionCount()` is accurate after each operation, and no orphaned queue state.

### 6. Concurrent dequeue with blocking wait

Two sessions blocking on `dequeue_update` simultaneously (timeout > 0). Send a message routed to SID 1. Only SID 1's dequeue should resolve. SID 2 should remain waiting (or time out empty).

### 7. Cross-session message passing

SID 1 calls `pass_message(sid=2, ...)` with valid auth. SID 2's queue receives the message. SID 1's queue does not.

### 8. Routing mode behavior under load_balance

Two idle sessions. Three messages arrive. Verify distribution follows load_balance rules (lowest idle SID first).

## Acceptance Criteria

- [ ] All 8 test scenarios above have passing tests (or documented reason for skip)
- [ ] Tests use real session-manager and session-queue instances (not mocked) where possible
- [ ] Telegram API calls remain mocked (no real network)
- [ ] Tests are in a dedicated file: `src/tools/multi-session-integration.test.ts`
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`

## Completion

**Agent:** Worker 1 (Sonnet)
**Reviewed by:** Overseer
**Date:** 2026-03-17

### What Changed

- **`src/tools/multi-session-integration.test.ts`** (NEW) — 22 integration tests covering all 8 scenarios. Uses real session-manager, session-queue, and routing-mode; only Telegram API is mocked.

### Test Results

- Tests added: 22 new tests in 1 file
- Total tests: 1346 (all passing)
- All 8 scenarios covered with multiple assertions each

### Findings

- Worker did not follow protocol: no completion report, no report to overseer, did not check acceptance criteria boxes
- The actual test quality is good — covers queue isolation, SID enforcement, voice ack, governor close/promotion, SID monotonicity, concurrent dequeue, cascade pass, and load-balance independence
- Scenario 4 tests confirmed that governor promotion already works in `close_session.ts` — this behavior predates the governor-default-routing task
- Scenario 7 confirms `pass_message` only works in cascade mode (NOT_CASCADE_MODE error otherwise)
