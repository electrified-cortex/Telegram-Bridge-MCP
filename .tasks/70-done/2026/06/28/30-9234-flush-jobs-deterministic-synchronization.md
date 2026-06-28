# 30-9234 — async-send-queue.test.ts: replace flushJobs hop-count with deterministic synchronization

**Priority**: Low  
**Tier**: Draft  
**Source**: AC5 follow-up from 30-9233 (Overseer waiver 2026-06-28)

## Problem

`flushJobs()` in `src/async-send-queue.test.ts` synchronizes by yielding 16 counted
microtask turns.  If the production code in `src/async-send-queue.ts` gains or loses
an `await`, all tests that rely on `flushJobs()` will silently over-settle or
under-settle without any compile-time or assertion-level signal.

A deterministic alternative was identified but not implemented because:
- Option A — `vi.runAllMicrotasksAsync()` does not exist in vitest 4.1.9.
- Option B — `deliverAsyncSendCallback` mock latch requires restructuring ~30+ call
  sites (enqueue-then-flush → setup-promise, enqueue, await-promise pattern).
- Option C — `vi.waitFor()` may work but requires validation that it handles
  microtask chains correctly for both audio and text-send paths.

## Goal

Replace the 16-await counted approach with a deterministic mechanism that fails
loudly if the production chain changes, without requiring manual hop-count updates.

## Candidate approaches

1. **`deliverAsyncSendCallback` latch** — implement `waitForJobCompletion()` and
   restructure all call sites.  Most correct; highest change volume (~30 sites).
   
2. **`vi.waitFor()` polling** — poll until `deliverAsyncSendCallback.mock.calls.length`
   increases; `{ interval: 0, timeout: 5000 }`.  Requires validating that text-send
   tests (which may not call `deliverAsyncSendCallback`) don't time out.

3. **Upgrade vitest** — check if vitest ≥ 4.2 exposes `vi.runAllMicrotasksAsync()`.

## Acceptance criteria

AC1: `flushJobs()` no longer contains counted sequential `await Promise.resolve()` calls.  
AC2: `flushJobs()` uses a mechanism that will fail (not silently pass) if the
     production promise chain depth changes.  
AC3: All 4003+ tests pass (no regressions).  
AC4: `pnpm exec tsc --noEmit -p tsconfig.eslint.json` reports 0 errors.

## Notes

The 16-await version with waiver comment lives at `dd49d504` on `dev` (squash
from worker/30-9230-9233-wave3-test-quality).  Any implementation can build on
that baseline.  Test-only change — no production code should be modified.

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: inline gate (test-only, well-bounded)
- checked: ACs binary (no counted awaits, deterministic failure on chain change, all tests pass, tsc clean), scope = single test file, three candidate approaches listed for worker evaluation, delegation correct, no blocking open questions

## Verification

- verifier: a6eea17e37dc49083
- date: 2026-06-28
- verdict: APPROVED
- commit: de239ed7 (squash b6040e5)
- AC1: CONFIRMED — flushJobs() body is entirely vi.waitFor(); zero counted awaits
- AC2: CONFIRMED — vi.waitFor() polls deliverAsyncSendCallback.mock.calls.length with 5s timeout; fails loudly if chain changes
- AC3: CONFIRMED — 4040/4040 tests pass (≥4003 required)
- AC4: CONFIRMED — tsc exits 0 before vitest (&&-chained in package.json test script)

Sealed-By: a6eea17e37dc49083
