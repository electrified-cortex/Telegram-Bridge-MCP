# 400 — Fix session approval message showing wrong session header

## Problem

When a second session calls `session_start`, the approval prompt sent to the operator incorrectly shows the **Overseer's** session header (e.g. `🟦 🤖 Overseer`). The approval message is a system-level prompt — it should have no session header at all.

## Root Cause

In `src/tools/session_start.ts`, the `requestApproval()` function sends messages via `getApi().sendMessage()` and `getApi().editMessageText()`. These go through the outbound proxy (`src/outbound-proxy.ts`), which calls `buildHeader()` → `getCallerSid()`.

`getCallerSid()` (in `src/session-context.ts`) returns:
```
_als.getStore() ?? getActiveSession()
```

The ALS context is set by the wrapper in `src/server.ts` (line ~92-97). For `session_start`, the new session doesn't have a SID yet, so `args.sid` is undefined. The wrapper falls back to `getActiveSession()`, which returns the Overseer's SID (1). So the entire `session_start` handler runs in the Overseer's ALS context, and the approval message gets the Overseer's header prepended.

## Fix

In `src/tools/session_start.ts`:

1. **Add import:** `import { runInSessionContext } from "../session-context.js";`
2. **Wrap the `requestApproval` call** (around line 170) in `runInSessionContext(0, ...)`:

```ts
const decision = await runInSessionContext(0, () =>
  requestApproval(chatId, effectiveName, reconnect, color));
```

This ensures `getCallerSid()` returns 0 during the approval flow. With SID 0, `buildHeader()` returns empty strings (no header), which is correct for system-level messages.

## Why SID 0 works

In `buildHeader()` (outbound-proxy.ts ~line 33):
- `sid > 0` is false → `session = undefined`
- `name = session?.name || (sid > 0 ? ... : "")` → empty string
- `if (!name)` → returns `{ plain: "", formatted: "" }` — no header

`runInSessionContext(0, fn)` stores `0` in ALS. `getCallerSid()` uses `??` (nullish coalescing), so `0 ?? getActiveSession()` returns `0` (not `undefined` or `null`).

## Acceptance Criteria

- [x] Approval messages for new sessions have **no** session header prefix
- [x] The edited approval result (approved/denied) also has no header
- [x] All existing `session_start.test.ts` tests still pass (49 tests)
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/` clean

## Completion

**Completed:** 2026-03-18

Implemented by wrapping the approval flow in `runInSessionContext(0, ...)` in `src/tools/session_start.ts`, so system approval messages run with SID 0 and therefore no session header is injected by the outbound proxy.

Verification:
- `pnpm vitest run src/tools/session_start.test.ts` passed (49/49)
- `pnpm typecheck` passed
- `pnpm lint` passed
