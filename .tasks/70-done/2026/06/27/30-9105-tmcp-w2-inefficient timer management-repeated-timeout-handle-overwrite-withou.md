---
created: 2026-06-28
status: draft
priority: 10
source: TMCP V8 quality audit swarm wave 2, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: medium
dimension: inefficient timer management
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: Repeated timeout handle overwrite without cleanup in retry path

**ID**: 30-9105
**Date**: 2026-06-28
**Dimension**: inefficient timer management
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/tools/activity/file-state.ts`

## Problem

scheduleRetry (line 296) overwrites entry.pendingRetryHandle without cancelling the previous timer. The reachable scenario: (1) a touch fails → scheduleRetry arms a 1-second retry and sets touchInFlight=false and notifyDebounceUntil=null, (2) before that second elapses a new inbound message passes all guards in notifyIfAllowed (touchInFlight is false, debounce is null), triggers another doTouchWithRollback, which also fails, and calls scheduleRetry again — overwriting the first handle without calling clearTimeout on it. The orphaned callback is NOT protected by the generation check at line 300: that check uses object identity (entry === _state.get(sid)), and since the same entry object is still in the map, both callbacks fully execute their retry logic. The result is two concurrent appendFile calls, two competing attempt+1 timer arms, and the second orphan repeating the same cycle. The bug is bounded (RETRY_DELAYS has two entries), but the scenario is realistic under any filesystem hiccup combined with a message burst.

## Offending Code

```typescript
entry.pendingRetryHandle = setTimeout(() => {
    void (async () => {
      entry.pendingRetryHandle = null;

      if (_state.get(sid) !== entry) return;
      // ... retry logic ...
      if (!ok) {
        scheduleRetry(sid, recheck, attempt + 1);
      }
    })();
  }, RETRY_DELAYS[attempt]);
```

## Fix

At line 296 in file-state.ts, before the setTimeout assignment, add:

if (entry.pendingRetryHandle !== null) {
  clearTimeout(entry.pendingRetryHandle);
}

This is a two-line change that brings scheduleRetry into parity with the clearTimeout pattern used everywhere else handles are overwritten in this file.

## Verification Notes

The finding is confirmed. One claim in the original description is inaccurate — the generation check at line 300 does NOT cause orphaned callbacks to return early in this scenario, because the same entry object reference remains in _state. The actual impact is worse than described: both the orphaned and replacement callbacks fully execute, racing to do an appendFile and to arm attempt+1 timers. The rest of the codebase (handleSessionStopped lines 617-620, resetNotifyGateState lines 584-587, clearActivityFile lines 660-663, replaceActivityFile lines 727-730, and pendingReNotifyHandle at lines 505-507) uniformly guards timer handles with clearTimeout before overwrite. scheduleRetry is the only exception and the fix is a two-line guard consistent with all existing patterns.

## Acceptance Criteria

- [ ] Issue resolved per fix description
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — ACs binary and testable, scope bounded (single targeted fix per file), delegation correct (Worker/Curator), self-contained fix with explicit location. PASS.

## Verification

- Verifier: a43ff25de80e5e324
- Date: 2026-06-27
- Verdict: APPROVED — clearTimeout guard + null reset before setTimeout assignment confirmed in scheduleRetry() src/tools/activity/file-state.ts:296-300; consistent with all other handle-overwrite guards in file. tsc clean. 4005/4005 tests pass.
- Sealed-By: Foreman, squash commit 5d2bebd8c9f29d57f7abc3bfb72614c07fea8b03, tests 4005/4005
