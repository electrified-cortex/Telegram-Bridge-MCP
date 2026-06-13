---
id: task-7-reminders-kick-activity-monitor
title: Fix TMCP reminders not kicking activity file monitor
status: review
created: 2026-05-27
source: Overseer bug report (BT confirmed not hard-blocked, normal priority)
target-file: src/tools/dequeue.ts
delegation: Worker (after Overseer review)
completed: 2026-05-27
---

# Fix: Reminders not kicking activity file monitor

## Problem

Three reminder return paths in `src/tools/dequeue.ts` fire reminder results to the calling agent but never call `kickIfAllowed()`. The activity file mtime is not updated, so the file watcher does not wake, and the agent's next dequeue relies on its session default timeout instead of a watcher kick.

**Affected paths:**

| Path | Lines | Description |
|---|---|---|
| P1 | 276–292 | Event-triggered reminders before timeout=0 return (pre-loop) |
| P2 | 344–359 | Event-triggered reminders inside the wait loop |
| P3 | 368–384 | Idle-threshold reminders inside the wait loop |

All three set `_lockoutRelease = true` (P2, P3) or call `releaseKickLockout` directly (P1), but none call `kickIfAllowed`.

## Root Cause

`kickIfAllowed` in `file-state.ts` suppresses kicks when `entry.inflightDequeue === true` (step 2 of the gate). For P2 and P3 (inside the try block), dequeue is still inflight when the reminder is returned, so any kick at that point would be suppressed.

For P1, `setDequeueActive(sid, false)` IS already called, clearing inflight — so a kick right after `releaseKickLockout` would succeed. This path is the simplest fix.

## Fix Applied

### P1 — Added kick after releaseKickLockout

```typescript
setDequeueActive(sid, false);
releaseKickLockout(sid);
resetChannelCooldown(sid);
kickIfAllowed(sid, "reminder", false);
return reminderResult;
```

### P2 and P3 — Added `_reminderKickNeeded` flag, kick in finally

```typescript
// At top of runDrainLoop:
let _reminderKickNeeded = false;

// P2 and P3 return sites:
_lockoutRelease = true;
_reminderKickNeeded = true;
return reminderResult;

// finally block:
if (_reminderKickNeeded) {
  kickIfAllowed(sid, "reminder", false);
}
```

## Overseer review

- **Reviewer**: Overseer
- **Date**: 2026-05-27
- **Verdict**: PASS

## Delivery

- [x] All three reminder paths call `kickIfAllowed(sid, "reminder", false)` on return
- [x] P2/P3 kick fires AFTER `setDequeueActive(sid, false)`
- [x] P2/P3 kick fires AFTER `releaseKickLockout`
- [x] Existing tests pass (3271/3271)
- [x] New tests: 4 tests in "reminder kick (activity monitor wakeup)" describe block
- [x] No kick regression on timeout=0 empty-poll path

## Verification

- **Verifier**: Foreman dispatch (standard tier)
- **Date**: 2026-05-27
- **Verdict**: APPROVED
- **Evidence**:
  - P1 kick: `dequeue.ts:291` — `kickIfAllowed(sid, "reminder", false)` before `return reminderResult`
  - P2 kick: `dequeue.ts:360` sets `_reminderKickNeeded = true`; `dequeue.ts:454–456` fires in finally after `setDequeueActive` (line 448) and `releaseKickLockout` (line 451)
  - P3 kick: `dequeue.ts:387` sets flag; same finally path
  - Ordering confirmed: `setDequeueActive` at 448 → `releaseKickLockout` at 451 → `kickIfAllowed` at 454–456
  - Tests: 3271/3271 pass; 4 new tests in "reminder kick (activity monitor wakeup)" block all pass
  - No-kick regression: timeout=0 empty-poll at lines 296–300 outside try scope; dedicated test confirms no kick
