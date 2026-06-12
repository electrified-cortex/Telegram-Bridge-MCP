# Task #020 — Proactive Rate Limiting

| Field    | Value                           |
| -------- | ------------------------------- |
| Priority | 30 (low — no active pain point) |
| Created  | 2026-03-20                      |

## Problem

The current rate limiter is purely **reactive** — it only kicks in after Telegram returns a 429. There's no proactive throttling to prevent hitting the limit in the first place, which could cause visible failures during burst activity (e.g., two sessions sending messages simultaneously, animation frames + tool responses overlapping).

## Current State

- `rate-limiter.ts` handles 429 responses: `recordRateLimit()`, `isRateLimited()`, `enforceRateLimit()`
- `debounceSend()` exists (1000ms mutex-based debounce) but is **dead code** — never imported or called
- `callApi()` in `telegram.ts` wraps API calls with 429 retry logic
- Animation state and poller have their own 429 handlers
- No per-method budgets, no token bucket, no sliding window

## Design Concepts (Discussion)

### Option A: Wire in `debounceSend()`
Simplest. Add `await debounceSend()` before every outbound API call in `callApi()`. Serializes all sends with a 1000ms floor. Downside: too aggressive — blocks even when there's plenty of headroom.

### Option B: Token Bucket
Classic rate limiter. Allow N requests per window (e.g., 30/sec for Bot API). Burst-friendly but needs tuning per Telegram's undocumented limits.

### Option C: Adaptive Throttle
Start permissive, tighten after 429s, relax after quiet periods. Self-tuning but more complex.

### Option D: Per-Method Budgets
Different limits for different API methods (`sendMessage` vs `editMessageText` vs `setMessageReaction`). Matches Telegram's actual rate limiting behavior (reactions are stricter than edits).

## Key Semantics to Clarify

- **"Debounce" definition**: In this codebase, `debounceSend()` is a minimum-gap enforcer (throttle), not a trailing-edge debounce. Need to align on terminology.
- **Blocking behavior**: Should rate limiting queue requests (wait) or reject them (fail fast)? Queuing is better UX but risks unbounded wait times.
- **Multi-session fairness**: Should each session get its own budget, or is it global?

## Open Questions

- What failure mode does the operator actually worry about? (Dropped messages? Visible errors? Delayed responses?)
- Is 1000ms gap too aggressive, too lenient, or about right?
- Should animation frames be exempt from throttling (they already handle 429 gracefully)?
