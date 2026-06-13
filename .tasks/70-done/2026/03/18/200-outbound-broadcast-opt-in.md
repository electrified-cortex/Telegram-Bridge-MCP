# Outbound Broadcast Opt-In

**Type:** Feature
**Priority:** 200 (Medium)

## Description

Cross-session outbound forwarding (`broadcastOutbound` in `session-queue.ts`) currently sends all `sent` events to every other session unconditionally. This is noisy — worker sessions don't need to see what other sessions are sending unless they explicitly opt in.

Change outbound broadcasting from **always-on** to **opt-in per session**.

## Current Behavior

- `broadcastOutbound(event, senderSid)` in `src/session-queue.ts` line 206 iterates all queues and enqueues to every session except the sender
- Every session receives `sent` events from all other sessions
- No way to disable or filter

## Desired Behavior

- Each session has a `receiveOutbound: boolean` flag, default **`false`**
- `broadcastOutbound()` only forwards to sessions where the flag is `true`
- Two new tools expose the flag:
  - `subscribe_outbound` — sets flag to `true` for the calling session
  - `unsubscribe_outbound` — sets flag to `false`
- Governor does NOT automatically get outbound — must opt in like everyone else
- Document the feature in `docs/multi-session.md` (replace the "Deferred" muting section)
- Update `get_agent_guide` output to mention the tools

## Code Path

- `src/session-queue.ts` — `broadcastOutbound()`, session queue state (add per-queue flag)
- `src/tools/` — new tool definitions for `subscribe_outbound` / `unsubscribe_outbound`
- `src/server.ts` — register the new tools
- `docs/multi-session.md` — update muting section

## Completion

**Status:** Done

### Changes Made

**`src/session-queue.ts`**

- Added `_outboundSubscriptions = new Set<number>()` module-level state
- Added `subscribeOutbound(sid)`, `unsubscribeOutbound(sid)`, `isOutboundSubscribed(sid)` exports
- Modified `broadcastOutbound()` to skip sessions not in `_outboundSubscriptions`
- `removeSessionQueue()` now also calls `_outboundSubscriptions.delete(sid)`
- `resetSessionQueuesForTest()` now also calls `_outboundSubscriptions.clear()`

**New files**

- `src/tools/subscribe_outbound.ts` — MCP tool, auth-gated, calls `subscribeOutbound(sid)`
- `src/tools/unsubscribe_outbound.ts` — MCP tool, auth-gated, calls `unsubscribeOutbound(sid)`
- `src/tools/subscribe_outbound.test.ts` — 4 tests for both tools (success + auth failure paths)

**`src/server.ts`**

- Registered `subscribe_outbound` and `unsubscribe_outbound` in the Session section

**`src/session-queue.test.ts`**

- Rewrote `broadcastOutbound` describe block (5 tests covering opt-out default, opt-in forwarding, waiter wake, sender exclusion, no-op edge cases)
- Added new `outbound subscription` describe block (4 tests: subscribe/unsubscribe/remove cleanup/reset cleanup)

**`src/multi-session.integration.test.ts`**

- Fixed 3 test locations that assumed always-broadcast — added explicit `subscribeOutbound()` calls

**`docs/multi-session.md`**

- Replaced "Muting (Deferred)" section with "Outbound Broadcast Opt-in" (real docs)
- Fixed stale anchor link in the Access Control section

**`docs/behavior.md`**

- Added "Outbound broadcast opt-in" subsection in the Inter-session communication section

### Test Results

- 1471 tests, 79 files — all pass (was 1461/78 before this task; +10 tests, +1 file)
- Lint: clean
- Build: clean
