# 540 — confirm.ts: use validated `_sid` instead of `getCallerSid()`

**PR Review Threads:** `PRRT_kwDORVJb9c51emLO`, `PRRT_kwDORVJb9c51emLj`

## Problem

In `src/tools/confirm.ts`, the tool handler validates the session via `requireAuth(identity)` and stores the result in `_sid` (line 84). However, two later callsites use `getCallerSid()` instead of the already-validated `_sid`:

1. **Line 92** — pending-updates guard:
   ```ts
   const sid = getCallerSid();  // ← should be _sid
   ```

2. **Line 171** — `pollButtonOrTextOrVoice` call:
   ```ts
   onVoiceDetected, signal, getCallerSid(),  // ← should be _sid
   ```

## Fix

Replace both `getCallerSid()` calls with `_sid`. If `getCallerSid` is no longer used anywhere in the file, remove the import.

## Completion

**Status:** Done — 1485/1485 tests pass, build clean.

**Changes:**
- `src/tools/confirm.ts`: replaced both `getCallerSid()` calls with `_sid`; removed `getCallerSid` import from `session-context.js`
- `src/tools/confirm.test.ts`: updated "rejects with PENDING_UPDATES when queue is non-empty" to set `mocks.sessionQueue.pendingCount.mockReturnValue(3)` — the old test was checking the global pending count (which was an artifact of `getCallerSid()=0` in tests); with `_sid=1`, the session queue is checked instead
