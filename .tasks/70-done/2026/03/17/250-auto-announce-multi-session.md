# Feature: Auto-Announce Multi-Session Activation

## Type

Feature / UX

## Description

When the second session joins and is approved, the server should automatically:

1. Switch routing to governor mode (SID 1 = governor)
2. Start injecting name tags on all outbound messages
3. Notify both sessions that multi-session mode is active

This makes multi-session "just work" — no manual configuration needed.

## Dependencies

- **200-governor-default-routing** — governor auto-activation logic
- **200-session-approval-gate** — approval before session creation
- **300-mandatory-message-headers** — name tag injection

## Current State

`session_start.ts` creates the session and sends an intro message. It already reports `fellow_sessions` when `sessionsActive > 1`. But it does NOT:

- Change routing mode
- Notify the existing session(s)
- Trigger name tag injection

## Code Path

1. `src/tools/session_start.ts` — after session creation, orchestrates the announce
2. `src/routing-mode.ts` — `setRoutingMode("governor", firstSessionSid)`
3. `src/session-queue.ts` — `broadcastOutbound()` can deliver notifications to all sessions
4. `src/outbound-proxy.ts` — name tag injection checks `activeSessionCount()` to decide

## Design

### Trigger

After `createSession()` succeeds and `activeSessionCount()` transitions from 1 → 2:

1. Auto-set routing: `setRoutingMode("governor", lowestActiveSid)`
1. Inject name tags: `activeSessionCount() > 1` is the only guard needed — outbound proxy checks this
1. Notify existing session(s) via internal broadcast:

    ```text
    📢 Multi-session active. 🤖 Worker has joined.
    Routing: governor (🤖 Primary handles ambiguous messages).
    ```

1. Return to the new session with routing info in the `session_start` response

### Teardown

When `activeSessionCount()` drops from 2 → 1:

1. Disable name tags (proxy stops prepending)
2. Reset routing to default
3. Notify remaining session: "Single-session mode restored"

## Acceptance Criteria

- [ ] Governor mode auto-activates when 2nd session joins
- [ ] Existing session(s) receive notification about new session
- [ ] Name tags start appearing on outbound messages immediately
- [ ] Teardown: name tags stop and routing resets when back to 1 session
- [ ] Remaining session notified on teardown
- [ ] Test: 2nd session join triggers auto-governor
- [ ] Test: close back to 1 session resets routing
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`

## Completion

**Agent:** Copilot (GitHub Copilot / Claude Sonnet 4.6)
**Date:** 2026-03-17

### What Changed

- **`src/tools/session_start.ts`**:
  - Added import: `deliverDirectMessage` from `../session-queue.js`
  - When `sessionsActive === 2` (2nd session joins), after `setRoutingMode("governor", ...)`, iterates over fellow sessions and calls `deliverDirectMessage(session.sid, fellow.sid, "📢 Multi-session active. 🤖 {joiner} has joined.\nRouting: governor (🤖 {governor} handles ambiguous messages).")`

- **`src/tools/close_session.ts`**:
  - Added import: `deliverDirectMessage` from `../session-queue.js`
  - Replaced the governor-death-recovery block with a three-way dispatch:
    1. `remaining.length === 1` (2→1): reset routing to `load_balance`, `sendServiceMessage`, `deliverDirectMessage(0, last.sid, "📢 Single-session mode restored...")` — **regardless of whether the closing session was the governor**
    2. `wasGovernor && remaining.length === 0` (last session was governor): reset to `load_balance`
    3. `wasGovernor && remaining.length >= 2` (governor closes with 2+ remaining): promote lowest-SID
    4. Non-governor closes with 0 or 2+ remaining: no routing change

- **`src/tools/session_start.test.ts`**: Added `deliverDirectMessage` to mocks and session-queue mock; added 4 new announcement tests:
  - "notifies existing sessions when 2nd session joins"
  - "does not notify when first session starts"
  - "does not notify when 3rd session joins"
  - "announcement includes governor name"

- **`src/tools/close_session.test.ts`**: Added `deliverDirectMessage` mock; updated "uses session name in promotion message" and "uses Session N label" tests to use 2+ remaining scenarios; added 5 new 2→1 teardown tests

- **`src/tools/multi-session-integration.test.ts`**: Updated 2 stale integration tests to reflect new 2→1 teardown behavior (no longer promotes to governor when only 1 session remains; resets to load_balance instead)

### Test Results

- Tests added: 4 (session_start) + 5 (close_session) = 9 new tests
- Total tests: 1 388 passing across 72 test files (0 failures)
- `pnpm lint` — 0 errors
- `pnpm build` — clean

### Findings

- The integration tests for governor promotion after close (`"closing governor session promotes next-lowest SID when sessions remain"` and `"closing a non-governor session does not affect routing mode"`) were written for old behavior (before 2→1 teardown was specified). Updated them to match the spec.
- Governor promotion only occurs now when 2+ sessions remain — correct, since a single-session system has no routing to configure.

### Acceptance Criteria Status

- [x] Governor mode auto-activates when 2nd session joins (already done in task 200-governor-default-routing)
- [x] Existing session(s) receive notification about new session (DM via `deliverDirectMessage`)
- [x] Name tags start appearing on outbound messages (outbound-proxy already checks `activeSessionCount() >= 2`)
- [x] Teardown: name tags stop and routing resets when back to 1 session
- [x] Remaining session notified on teardown (DM via `deliverDirectMessage(0, last.sid, ...)`)
- [x] Test: 2nd session join triggers notification to existing sessions
- [x] Test: close back to 1 session resets routing and delivers DM
- [x] All tests pass: `pnpm test` — 1 388/1 388
- [x] No new lint errors: `pnpm lint` — 0 errors
- [x] Build clean: `pnpm build` — clean

