---
created: 2026-06-28
status: draft
priority: 30
source: adversarial review ab8cb879ac2793eff, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TestGap
severity: low
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
---

# TMCP — Fix AC2 test in session-parent-notify.test.ts (trivial mock)

**ID**: 10-3071
**Date**: 2026-06-28
**Priority**: Low
**Origin**: Adversarial review ab8cb879ac2793eff (post-push finding #2)

## Problem

The AC2 test in `src/session-parent-notify.test.ts` ("child's setDequeueActive does not affect parent gate") mocks `isDequeueActive` via `vi.mock(...)`, but `notifyIfAllowed` never calls `isDequeueActive` — it reads `entry.inflightDequeue` directly from the `_state` map. The mock has zero effect on production behavior; the test passes trivially because the parent's fresh entry has `inflightDequeue = false`.

The underlying implementation is architecturally correct (parent and child state are independent in `_state`). Only the test is wrong.

## Fix

Replace the `isDequeueActive` mock approach with direct state manipulation:

```ts
// Instead of mocking isDequeueActive:
setDequeueActive(CHILD_SID, true);  // real function, mutates _state for CHILD_SID
// Then verify notifyIfAllowed(PARENT_SID, "operator", false) still returns true
```

This exercises the actual code path and would have caught a real regression if `inflightDequeue` were accidentally shared.

## Acceptance Criteria

- [ ] **AC1**: AC2 test updated to use `setDequeueActive(CHILD_SID, true)` instead of `vi.mock('isDequeueActive', ...)`.
- [ ] **AC2**: Updated test still passes (implementation is correct; test should remain green).
- [ ] **AC3**: No other tests broken. Suite still passes (4038+/4038+ expected).

## Notes

- File: `src/session-parent-notify.test.ts`
- Do NOT change production code — this is a test-only fix.
- Pre-existing lint baseline (visual-attachment-pipeline.ts, send.visual-pipeline.test.ts) must not be touched.

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: inline gate (test-only, trivial scope)
- checked: ACs binary (use real setDequeueActive, test passes, no regressions), scope = single test file, delegation correct, no open questions

## Verification

- verifier: a007ffbcc1bae531b
- date: 2026-06-28
- verdict: APPROVED
- commit: 15d73e7d (squash b6040e5)
- AC1: CONFIRMED — setDequeueActive(CHILD_SID, true) used; vi.mock approach removed
- AC2: CONFIRMED — test still passes; production correctness unchanged
- AC3: CONFIRMED — 4040/4040 tests pass, 166 test files

Sealed-By: a007ffbcc1bae531b
