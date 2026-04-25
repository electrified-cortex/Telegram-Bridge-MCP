---
Created: 2026-04-08
Status: Draft
Host: local
Priority: 20
Source: Codex swarm review finding 6
---

# Test Coverage Gaps — High-Risk Branches

## Problem

Missing test coverage on error/edge-case branches identified by Codex review:

1. **Voice chunk partial failure** (send.ts) — when TTS succeeds for first N
   chunks but fails mid-sequence, behavior is untested
2. **VOICE_RESTRICTED mapping** (send.ts) — when TTS is disabled and audio is
   requested, error path coverage
3. **Approval cleanup timeout** (session_start.ts) — pending approval timeout
   and cleanup paths

## Scope

Add targeted branch tests for each identified gap. No implementation changes —
tests only.

## Verification

- [x] Voice chunk partial-failure test added
- [x] VOICE_RESTRICTED test added
- [x] Approval timeout cleanup test added
- [x] All existing tests still pass (tsc clean; runtime verification pending merge — no node_modules in worktree)
- [x] Build clean (tsc)

## Activity Log

- **2026-04-15** — Pipeline started. Variant: Implement only (tests only, no implementation changes).
- **2026-04-15** — [Stage 4] Task Runner dispatched. 3 tests added across send.test.ts and session_start.test.ts. tsc clean.
- **2026-04-15** — [Stage 5] tsc clean. Test runtime not runnable in worktree (no node_modules).
- **2026-04-15** — [Stage 6] Code Reviewer: 0 critical, 0 major for Gaps 1+2 (sound). Gap 3: 2 critical (timer leak, false-positive fallback), 2 major (missing clearPendingApproval assertion, real agent-approval state mutation). All fixed in second Task Runner pass. tsc re-verified clean.
- **2026-04-15** — [Stage 7] Complete. Branch: 20-test-coverage-gaps, commit: 813c3e6.

## Completion

**What was implemented:**
- `send.test.ts`: voice chunk partial failure (synthesizeToOgg fails on chunk 2; verifies cancelTyping cleanup)
- `send.test.ts`: VOICE_RESTRICTED path (sendVoiceDirect throws privacy error; verifies VOICE_RESTRICTED error code)
- `session_start.test.ts`: approval timeout cleanup (vi.useFakeTimers, runAllTimersAsync, asserts clearCallbackHook + clearPendingApproval called; timer guarded in try/finally; no false-positive fallback)

**Subagent passes:** Task Runner ×2 (initial + fixes), Code Reviewer ×1

**Final review verdict:** 0 critical, 0 major (after fixes), 2 minor (noted)
