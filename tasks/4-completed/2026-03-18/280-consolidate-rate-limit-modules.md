# Consolidate rate-limit tracking into a single module

**Type:** Refactor
**Priority:** 280 (Normal — architecture cleanup)
**Source:** Copilot PR review #5 (2026-03-19)

## Problem

Rate-limit state is tracked in **two independent modules**, each with its own `_rateLimitUntil` variable:

1. **`src/rate-limiter.ts`** (lines 33–68) — `recordRateLimit()`, `isRateLimited()`, `rateLimitRemainingSecs()`, `enforceRateLimit()`
2. **`src/telegram.ts`** (lines 206–231) — `recordRateLimitHit()`, `getRateLimitRemaining()`, `clearRateLimitForTest()`

Both maintain separate `_rateLimitUntil` epoch-ms timestamps. When a 429 arrives, only the module that handles the response gets updated. The other module's window stays stale.

### Current callers

- `src/outbound-proxy.ts` — calls `enforceRateLimit()` and `recordRateLimit()` from `rate-limiter.ts`
- `src/animation-state.ts` — calls `isRateLimited()` from `rate-limiter.ts`
- `src/tools/get_debug_log.ts` — calls `getRateLimitRemaining()` from `telegram.ts`
- Tests — call `clearRateLimitForTest()` from `telegram.ts`

## Fix

Make `telegram.ts` delegate to `rate-limiter.ts` for all rate-limit state:

1. Remove the `_rateLimitUntil` variable, `recordRateLimitHit()`, and `getRateLimitRemaining()` from `telegram.ts`
2. Have `telegram.ts` re-export or call through to `rate-limiter.ts`:
   - `recordRateLimitHit(n)` → call `recordRateLimit(n)` from rate-limiter
   - `getRateLimitRemaining()` → call `rateLimitRemainingSecs()` from rate-limiter
   - `clearRateLimitForTest()` → add a `clearForTest()` export to rate-limiter or keep a thin wrapper
3. Update imports in any file that was using the `telegram.ts` exports directly
4. Verify `recordRateLimitHit` handles `undefined` the same way (defaults to 5s) — add this default to the consolidated version if needed

## Code Path

- `src/telegram.ts` — remove duplicate rate-limit state (lines 206–231)
- `src/rate-limiter.ts` — single source of truth (add `clearForTest()` if missing)
- `src/tools/get_debug_log.ts` — update import if needed
- Test files — update imports for `clearRateLimitForTest`

## Acceptance Criteria

- [ ] Only one `_rateLimitUntil` variable exists (in `rate-limiter.ts`)
- [ ] `telegram.ts` no longer has its own rate-limit state
- [ ] All callers (`outbound-proxy.ts`, `animation-state.ts`, `get_debug_log.ts`, tests) use the same rate-limit source
- [ ] `recordRateLimit` handles `undefined` retryAfter (default to 5 seconds)
- [ ] Typecheck clean — `pnpm typecheck`
- [ ] Lint clean — `pnpm lint`
- [ ] Existing tests pass — `pnpm test`
- [ ] `changelog/unreleased.md` updated under `## Changed`
