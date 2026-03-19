# 130 — temp-reaction setTimeout loses session context

**Priority:** 130 (High)
**Type:** Bug
**Status:** Queued
**Created:** 2026-03-19
**Source:** PR #40 review thread `PRRT_kwDORVJb9c51X_sH`

## Problem

`setTempReaction` schedules a `setTimeout` callback that calls `fireTempReactionRestore()`. That function uses `getCallerSid()` (reads from AsyncLocalStorage) to determine which session's reaction to restore. But inside a `setTimeout`, there is **no ALS context** — `getCallerSid()` returns `0`, so the restore either fails silently or targets the wrong session.

## Observed Behavior

When the timeout fires, `fireTempReactionRestore()` at line 75 calls `getCallerSid()` and gets `0` instead of the original session's SID. The slot lookup `_slots.get(0)` returns `undefined`, so the restore is a no-op — the temporary reaction stays forever or until something else clears it.

## Code Path

- `src/temp-reaction.ts` L54: `setTimeout(() => { void fireTempReactionRestore(); }, ...)`
- `src/temp-reaction.ts` L75: `const sid = getCallerSid();` — returns 0 inside setTimeout
- `src/temp-reaction.ts` L40: `const sid = getCallerSid();` — correct at set-time

## Fix

Capture `sid` at set-time and pass it to the restore function, or use `runInSessionContext(sid, ...)` to wrap the timeout callback.

**Option A** (simplest): Change `fireTempReactionRestore()` to accept an optional `sid` parameter, falling back to `getCallerSid()` if not provided. Pass the captured `sid` from `setTempReaction`:

```ts
const capturedSid = sid; // already captured at L40
const handle = timeoutSeconds != null
  ? setTimeout(() => { void fireTempReactionRestore(capturedSid); }, timeoutSeconds * 1000)
  : null;
```

**Option B**: Import `runInSessionContext` and wrap the timeout:

```ts
setTimeout(() => { void runInSessionContext(sid, () => fireTempReactionRestore()); }, ...)
```

## Acceptance Criteria

- [ ] `fireTempReactionRestore` correctly identifies the session when called from a setTimeout
- [ ] Existing tests pass
- [ ] New test: set a temp reaction with a short timeout, advance timers, verify the reaction is restored for the correct session (not SID 0)
- [ ] Changelog entry added
