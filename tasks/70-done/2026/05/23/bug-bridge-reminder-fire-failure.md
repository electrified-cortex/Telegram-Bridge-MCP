---
id: bug-bridge-reminder-fire-failure
title: CRITICAL — Reminder fire mechanism failure — deferred reminder never delivered
type: bug
severity: critical
status: pending
filed_by: BT
filed_at: 2026-05-23T21:00:00Z
target_repo: electrified-cortex/Telegram-Bridge-MCP
delegation: Worker-claimable
---

# bug-bridge-reminder-fire-failure

## Summary

A real reminder (`pickup-lenora-230`) reached `fires_in_seconds: 0` while in `state: deferred` and was never delivered. The operator missed a 2:30 PM pickup as a result. Severity: CRITICAL — live reminder failure.

## Reproduction / known state

- Reminder ID: `pickup-lenora-230`
- State at failure: `deferred`
- `fires_in_seconds` reached `0` while in deferred state
- Expected: reminder fires/delivers on reaching 0
- Actual: reminder silently dropped, never delivered

## Source

BT filed at: the agents host (`<host>:<deploy-root>/bt/.bt-pod/outbox/bug-bridge-reminder-fire-failure.md`)

## Investigation needed

1. How does the bridge handle a deferred reminder reaching `fires_in_seconds: 0`?
2. Is there a race condition between deferred state and the fire timer?
3. Is the deferred → pending/active transition gated on something that didn't happen?
4. Check reminder-state.ts / reminder lifecycle for deferred → fire path

## Acceptance criteria

- AC1. Root cause identified and documented
- AC2. Fix implemented so deferred reminders fire correctly when timer expires
- AC3. Test case added covering deferred → fire at `fires_in_seconds: 0`
- AC4. No regression on non-deferred reminders

## Verification

- **Verdict:** APPROVED
- **Verified at:** 2026-05-23T23:52:38Z
- **Squash commit:** a7c0f31
- **AC1:** CONFIRMED — root cause documented in `src/tools/dequeue.ts` +210–216 and `.worker-pod/.temp/test-plan.md`
- **AC2:** CONFIRMED — `promoteDeferred(sid)` called unconditionally before immediate-batch path (line 220) and timeout=0 early return (line 233)
- **AC3:** CONFIRMED — 4 new tests in `src/reminder-state.test.ts` under "deferred → fire at fires_in_seconds=0 (regression: bug-bridge-reminder-fire-failure)"; 3 additional path-coverage tests in `src/tools/dequeue.test.ts`
- **AC4:** CONFIRMED — 3183 tests pass (3176 baseline + 7 new), 0 regressions, exit code 0
