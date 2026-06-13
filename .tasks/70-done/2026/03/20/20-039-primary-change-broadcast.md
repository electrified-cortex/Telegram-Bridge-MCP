# Task #039: Primary-Change Broadcast Chat Message

**Priority:** 20 | **Status:** Draft

## Problem

When the operator uses `/primary` to change the primary session, the change is applied silently — sessions receive `governor_changed` / `governor_promoted` service messages via `dequeue_update`, but there is no visible chat message that announces the new primary to the operator or to other observers.

## Goal

When the primary session changes, send a visible broadcast message to the Telegram chat announcing the new primary session by name. This message is **not pinned**.

## Design

- Message format (example): `🟨 Worker is now the primary session.`
- Sent as a regular chat message (not a service event, not pinned)
- Sent after the governor handoff is committed
- All active sessions receive the internal `governor_changed` / `governor_promoted` service events as today (no change there)

**Do not pin.** The session announcement pins (one per session) are the targeting mechanism. The primary-change message is informational only and does not add a pin.

## Scope

### `src/built-in-commands.ts` — `handleGovernorCallback()`

After `setGovernorSid(newSid)` and the existing service event broadcasts, send a chat message:

```
🔀 ${newSessionLabel} is now the primary session.
```

Where `newSessionLabel` is the nametag of the newly-selected session (color + name, e.g. `🟨 Worker`).

### Tests

- Add test: after `/primary` callback selects a new session, a broadcast chat message is sent
- Verify: message is NOT passed to `pinChatMessage`

## Acceptance Criteria

- When primary changes, a visible message appears in the Telegram chat
- The message accurately names the new primary session
- No new pins are created
- Existing service event broadcasts (`governor_changed`, `governor_promoted`) unchanged

## Completion

- Imported `sendServiceMessage` in `src/built-in-commands.ts`
- Added `sendServiceMessage("🔀 ${newLabel} is now the primary session.").catch(() => {})` after `setGovernorSid(newSid)` in `handleGovernorCallback()`
- One assertion added to "governor:set promotes" test; one new test "does not send broadcast on no-op"
- Also fixed `shutdown.test.ts` beforeEach to reset `resolveChat` after `clearAllMocks` (found during #038 test work)
- All 16 shutdown tests pass; all 55 built-in-commands tests pass
- Commit: `2902fe1` on dev
