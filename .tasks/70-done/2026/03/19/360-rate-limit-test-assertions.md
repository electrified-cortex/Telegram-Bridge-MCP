# 360 — Add assertions to rate-limit 429 recording test

**Priority:** 360 (Normal)
**Type:** Testing
**Status:** Queued
**Created:** 2026-03-19
**Source:** PR #40 review thread `PRRT_kwDORVJb9c51WLl5`

## Problem

The test `"pre-check: records rate limit window when 429 is encountered"` in `telegram.test.ts` at line 343 has **no assertions**. It sets up a mock 429 error, calls `callApi`, advances timers, and awaits — but never verifies that the rate-limit window was actually recorded. The test will pass even if rate-limit recording is completely broken.

## Code Path

- `src/telegram.test.ts` L343-358: test body with no `expect()` calls
- `src/telegram.ts`: `callApi` function, `recordRateLimitHit`, `getRateLimitRemaining`

## Fix

Add concrete assertions to the test:

1. After the 429 is encountered but before timers advance, verify `getRateLimitRemaining()` returns a positive value
2. Verify the retry_after window duration matches what was set (approximately 10 seconds)
3. After timers advance past the window, verify `getRateLimitRemaining()` returns 0

The tricky part is that `vi.runAllTimersAsync()` advances past the window, so you need to check the window *during* the retry. Consider using `vi.advanceTimersByTimeAsync(500)` to advance partially and check mid-window.

## Acceptance Criteria

- [x] Test has at least 2 meaningful `expect()` calls
- [x] Test validates that a rate-limit window is recorded when 429 is encountered
- [x] Test validates that the window expires after the retry_after period
- [x] All existing tests pass

## Completion

**Date:** 2026-03-19
**Worker:** Worker 1 (SID 2)

### What was done

- Added 3 `expect()` assertions to `"pre-check: records rate limit window when 429 is encountered"` in `src/telegram.test.ts`:
  1. Flush microtasks with `vi.advanceTimersByTimeAsync(0)` after starting `callApi(fn)` — lets the 429 be caught and `recordRateLimit(10)` invoked while the 10s retry timer is still frozen
  2. `expect(getRateLimitRemaining()).toBeGreaterThan(0)` — window is recorded
  3. `expect(getRateLimitRemaining()).toBeLessThanOrEqual(10)` — within expected range
  4. Advance all timers and await the promise, then `expect(getRateLimitRemaining()).toBe(0)` — window expired
- Changelog entry added to `changelog/unreleased.md` under `Fixed`

### Verification

- 79/79 telegram tests pass
- 1482/1482 total tests pass
- Build clean
