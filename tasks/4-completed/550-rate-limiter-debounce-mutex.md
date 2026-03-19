# 550 — rate-limiter.ts: debounceSend concurrency guard

**PR Review Thread:** `PRRT_kwDORVJb9c51emKW`

## Problem

`debounceSend()` in `src/rate-limiter.ts` is not concurrency-safe. If two calls enter simultaneously:

1. Both read `_lastSendAt` at the same time.
2. Both compute the same gap and sleep the same amount.
3. Both set `_lastSendAt` after waking — violating the debounce invariant.

## Fix

Add a simple mutex/promise chain so concurrent callers are serialized. Example approach:

```ts
let _sendLock: Promise<void> = Promise.resolve();

export async function debounceSend(): Promise<void> {
  const ticket = _sendLock;
  let resolve!: () => void;
  _sendLock = new Promise<void>(r => { resolve = r; });
  await ticket;
  const gap = Date.now() - _lastSendAt;
  if (gap < MIN_SEND_INTERVAL_MS) {
    await new Promise<void>(r => setTimeout(r, MIN_SEND_INTERVAL_MS - gap));
  }
  _lastSendAt = Date.now();
  resolve();
}
```

Reset `_sendLock` in `resetRateLimiterForTest()`.

## Acceptance

- Concurrent `debounceSend()` calls are serialized.
- Add a test verifying two concurrent calls don't fire within `MIN_SEND_INTERVAL_MS`.
- All existing tests pass.
