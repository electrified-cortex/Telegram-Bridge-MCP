---
created: 2026-06-28
status: draft
priority: 20
source: TMCP V8 quality audit swarm wave 2, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: low
dimension: Correctness / Missing Cleanup
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: _armReminderTimers not cancelled on session teardown — spurious reminder delivery

**ID**: 30-9104
**Date**: 2026-06-28
**Dimension**: Correctness / Missing Cleanup
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/sse-endpoint.ts`

## Problem

The "unbounded map growth" framing in the finding is wrong — the entry is self-healing within 45 seconds unconditionally, and on a Telegram bridge the population of stale entries is bounded to a handful at any moment. The real defect is behavioral. The timer callback at line 76 decides whether to fire ONBOARDING_ARM_REMINDER by checking `if (!_connections.has(sid))`. After `cancelSseConnection` runs, `_connections.delete(sid)` has already executed, so this check returns true regardless of whether the SSE was "never armed" (intended) or "explicitly cancelled" (wrong). This causes two concrete mis-fires: (1) an agent that calls activity/listen then activity/listen/cancel receives a spurious arm-reminder 45 seconds later; (2) during full session teardown (session-teardown.ts line 108 calls cancelSseConnection, line 100 calls removeSessionQueue), the timer fires and calls deliverServiceMessage against a queue that no longer exists. The on-connect path at lines 185-189 already performs clearTimeout + delete correctly; cancelSseConnection is the mirror path and is inconsistent.

## Offending Code

```typescript
export function cancelSseConnection(sid: number): void {
  const res = _connections.get(sid);
  _connections.delete(sid);
  unregisterSseMonitor(sid, true);
  _onboardingParticipatingFired.delete(sid);
  if (!res) return;
  // _armReminderTimers is never cleaned here
}
```

## Fix

**File**: `src/sse-endpoint.ts` — `cancelSseConnection()` function (line 119)

Insert a timer-cancel block immediately after `_onboardingParticipatingFired.delete(sid)` (line 128), **before** the `if (!res) return` early-exit — because the arm-reminder timer can exist even when no SSE connection is open:

```typescript
// CURRENT cancelSseConnection (lines 119–137):
export function cancelSseConnection(sid: number): void {
  const res = _connections.get(sid);
  _connections.delete(sid);
  unregisterSseMonitor(sid, true);
  _onboardingParticipatingFired.delete(sid);
  if (!res) return;   // <-- early exit MISSES the timer cleanup
  // ...
}

// AFTER — add 4 lines before the early-exit:
export function cancelSseConnection(sid: number): void {
  const res = _connections.get(sid);
  _connections.delete(sid);
  unregisterSseMonitor(sid, true);
  _onboardingParticipatingFired.delete(sid);
  // Cancel any pending arm-reminder timer — mirrors the on-connect cancel at lines 185-188.
  const pendingReminder = _armReminderTimers.get(sid);
  if (pendingReminder !== undefined) {
    clearTimeout(pendingReminder);
    _armReminderTimers.delete(sid);
  }
  if (!res) return;
  // rest of function unchanged
}
```

The on-connect path already does this correctly (lines 185–189 of `sse-endpoint.ts`). This is the mirror fix for the cancel path.

## Verification Notes

The finding is genuine, though mislabelled. The map growth concern is trivially bounded and self-healing; the actual problem is that cancelling an SSE connection does not cancel the pending reminder timer, so the timer fires and (a) delivers a spurious ONBOARDING_ARM_REMINDER to a session that explicitly cancelled, or (b) calls deliverServiceMessage on a queue removed by session teardown. The on-connect cancel path (lines 185-189) does this correctly already — cancelSseConnection is the inconsistent mirror. The fix is 3-4 lines and zero risk.

## Acceptance Criteria

- [ ] Issue resolved per fix description
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer gate bounce

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: BOUNCE — Same failure mode as 30-9102: Fix section references "the proposed fix in the finding" without including the actual code. Worker cannot execute without the external audit document. Embed the specific cancellation call(s) needed, the exact insertion point (file path + line anchor), and the complete code change directly in the Fix section.

## Overseer stamp (re-gate)

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — Fix now fully embedded: 4-line insertion, exact location before early-exit in src/sse-endpoint.ts:119, with reference to mirror pattern at lines 185-189. ACs binary. Scope correct. PASS.

## Verification

- Verifier: a43ff25de80e5e324
- Date: 2026-06-27
- Verdict: APPROVED — clearTimeout + _armReminderTimers.delete(sid) confirmed in cancelSseConnection() src/sse-endpoint.ts:123-131; mirrors on-connect cancel path. tsc clean. 4005/4005 tests pass.
- Sealed-By: Foreman, squash commit 5d2bebd8c9f29d57f7abc3bfb72614c07fea8b03, tests 4005/4005
