---
Created: 2026-05-05
Status: backlog
Priority: low
Source: operator voice 2026-05-05 msg 50376
---

# Extract `delay(ms)` async helper and timing constants

## Problem

Two related code-quality issues found throughout TMCP source:

1. The pattern `await new Promise(resolve => setTimeout(resolve, ms))` is repeated inline across `src/` and tests with no shared helper.
2. Magic timing values (e.g. `300_000` for long-poll timeout, `30_000` for debounce) appear as bare numbers with no named constants, making the codebase hard to audit and adjust.

Operator note (voice msg 50376, distilled): this should be a single simple helper (e.g. a `delay`/async-delay function) rather than the heavily replicated inline pattern, and the timing values should be configurable.

## Acceptance Criteria

- [x] `delay(ms: number): Promise<void>` exported from a shared helper module (e.g. `src/utils/timing.ts`).
- [x] Every inline `new Promise(resolve => setTimeout(resolve, ms))` in `src/` replaced with `delay(ms)`.
- [x] Test files updated to use `delay(ms)`.
- [x] Magic timing values >100 ms in non-test code use named constants.
- [x] If extracted constants reveal disagreements between modules on what a value should be, surface as a separate finding — do not silently unify.
- [x] All existing tests pass (no behavioral change).

## Overseer review
- reviewer: Overseer SID-3
- date: 2026-06-01
- verdict: PASS
- review type: adversarial dispatch
- checked: ACs binary (helper exported, grep-verifiable replacements, named constants, tests pass), scope bounded to src/, no target file issues
- not checked: none warranted

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `20a80adb` on `dev`
- **Worker commit:** `cab87de9` on `worker/30-2200-extract-delay-helper-and-timing-constants`
- **Test evidence:** 3279/3279 tests pass (142 files), tsc clean
- **Named constants:** `GRACEFUL_SHUTDOWN_TIMEOUT_MS`, `SHUTDOWN_POLL_INTERVAL_MS`, `POST_VOICE_SEND_DELAY_MS`
- **Intentional skips:** 2 handle-capturing setTimeout patterns (dequeue.ts:480, send/ask.ts:148) — require clearTimeout on handle; wrapping would leak timers
- **Semantic conflict surfaced:** `FLUSH_DELAY_MS` (500ms, log flush) vs `SHUTDOWN_POLL_INTERVAL_MS` (500ms, shutdown poll) — same value, different semantics, kept separate
