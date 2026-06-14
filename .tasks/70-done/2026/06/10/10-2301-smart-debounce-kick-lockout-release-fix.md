---
id: 10-2301-smart-debounce-kick-lockout-release-fix
title: "BT-2301 Smart-debounce: release lockout on timeout-exit dequeue + full spec verify"
Created: 2026-06-10
Status: done
Priority: 10
type: fix
Branch: dev-7.9
Spec: tasks/10-drafts/activity-aware-kick-timing-2026-05-17.md
Stamp: Overseer-pass-2026-06-10
---

# BT-2301 — Smart-debounce kick lockout: release on timeout exits + spec verification

## Context

The smart-debounce mechanism (kickIfAllowed / releaseKickLockout) is implemented and working
for the content-returning dequeue path. One gap remains:

**BLOCKER 0b (from swarm review task 20-1903):** A fully-parked agent whose last dequeue
TIMED OUT holds a stale lockout. A reminder due in that window gets suppressed by kickIfAllowed
(file-state.ts:325-328) and the agent is not woken. The mis-delivery only occurs when the agent
has a dequeue timeout shorter than the reminder fire window (~6s), but it is real and
observable at BT.

Operator authorized fix: **release the lockout on ALL dequeue exits, including timeout exits.**
(The original rationale for skipping timeout exits — rate-limiting "wedged" agents — is thin;
a polling-and-timing-out agent is not wedged.)

## Required change

In `src/tools/dequeue.ts`, set `_lockoutRelease: true` on the timeout-exit path as well as the
content-returning path. Specifically, the paths currently skipping lockout release (`:511`, `:520`
timeout-path) should call `releaseKickLockout(sid)` the same way content-returning paths do.

Verify against the full spec ACs (tasks/10-drafts/activity-aware-kick-timing-2026-05-17.md):
- Verify all 10 ACs pass, with particular attention to AC #6 (polling agent + lockout).
- Add/update a test for the timeout-exit lockout release path.

## Also required (same PR)

The open architectural blocker **B3** was deferred from v7.9.0 ship but is marked "MUST be done
before adding any second transport." Assess whether it can be included in this PR:
- `reminder-state.ts` imports `kickSseSubscriber` directly from `sse-endpoint.js` (domain→transport violation)
- Fix: inject the kick callback at module init; domain never names the transport
- If the change is clean and bounded, include it. If risky/large, note explicitly for post-7.9.

## Acceptance

1. BLOCKER 0b: a file-parked agent with sub-6s dequeue timeout receives reminder kicks after
   a timeout-exit dequeue. Test proves it.
2. All existing tests pass on dev-7.9.
3. No regressions in the other 9 AC scenarios from the spec.
4. PR targets dev-7.9 branch.

## Out of scope

Open non-critical findings in 20-1903 (log injection, IDOR on schedule, etc.) — those are 7.9.1.

## Verification

**Verdict:** APPROVED
**Verifier:** Dispatch sub-agent (standard tier)
**Date:** 2026-06-10

- AC1 (BLOCKER 0b fix): CONFIRMED — `src/tools/dequeue.ts:511` sets `_lockoutRelease=true` on timeout-exit path; `finally` block calls `releaseKickLockout(sid)` on all exits. 4 new tests in `dequeue.test.ts:1354–1396` prove behaviour.
- AC2 (all tests pass): CONFIRMED — 3371/3371 tests pass, 146/146 files, typecheck clean. Evidence: `.worker-pod/.temp/test-results.md`.
- AC3 (no regressions): CONFIRMED — AC6 in `file-state.test.ts` updated; all other ACs structurally intact and passing per test run.
- AC4 (targets dev-7.9): CONFIRMED — branch diverges from `994647da` (tip of dev-7.9), one commit ahead.
- B3 fix (also required): CONFIRMED — `reminder-state.ts` no longer imports `sse-endpoint` directly; injectable `initReminderSseKick()` pattern used; `index.ts` wires at startup.

**Squash commit:** `0f0159af` on `dev-7.9`
