# Bug: requireAuth Validates SID but Doesn't Set Session Context

## Type

Bug — Critical

## Found During

Multi-session manual testing (2026-03-18)

## Symptom

When S1 (Primary) calls `send_text` with `identity: [1, 919877]`, the outbound message appears with the header "🤖 Scout" (S2's name) instead of "🤖 Primary". The message is attributed to the wrong session.

## Root Cause

`requireAuth(identity)` in `src/session-gate.ts` validates the `[sid, pin]` tuple and returns the correct SID, but **never calls `runInSessionContext(sid, ...)`**. The outbound proxy's `buildHeader()` calls `getCallerSid()`, which falls back to `getActiveSession()` — a global that returns whichever session last called any tool.

### Code Path

1. Tool handler calls `requireAuth(identity)` → returns `1` (correct)
2. SID stored in `_sid` local variable but NOT propagated to `AsyncLocalStorage`
3. Handler calls `getApi().sendMessage(...)` → outbound proxy intercepts
4. `buildHeader()` calls `getCallerSid()` → `AsyncLocalStorage` has no value → falls back to `getActiveSession()` → returns `2` (wrong — S2 was the last session to call a tool)
5. Header shows "🤖 Scout" instead of "🤖 Primary"

### Affected Code

- `src/session-gate.ts` — `requireAuth()` returns SID but doesn't set ALS
- `src/outbound-proxy.ts` — `buildHeader()` relies on `getCallerSid()` which gets wrong value
- `src/message-store.ts` — `recordOutgoing()` calls `getCallerSid()` for message ownership
- All 32 gated tools — none wrap their handler in `runInSessionContext`

## Fix Options

### Option A — Fix in `requireAuth` (Recommended)

Make `requireAuth` set the ALS context. Since it's called at the top of every handler and the handler is async, we need to restructure so the tool handler body runs inside the context:

```typescript
// New: requireAuthAndRun wraps the handler
export async function requireAuthAndRun<T>(
  identity: [number, number] | undefined,
  fn: (sid: number) => Promise<T>,
): Promise<T | ErrorResult> {
  const sid = requireAuth(identity);
  if (typeof sid !== "number") return toError(sid);
  return runInSessionContext(sid, () => fn(sid));
}
```

This requires changing all 32 tool handlers to use the wrapper pattern.

### Option B — Set global active session in requireAuth

```typescript
export function requireAuth(identity) {
  // ... validation ...
  setActiveSession(sid); // <-- add this
  return sid;
}
```

Simpler but re-introduces the race condition that ALS was meant to solve. Two concurrent tool calls from different sessions would overwrite each other.

### Option C — Pass SID explicitly through the call chain

Have `recordOutgoing` and `buildHeader` accept an explicit `sid` parameter instead of reading from context. More invasive but eliminates the implicit dependency.

## Acceptance Criteria

- [ ] `send_text` with `identity: [1, pin]` shows "🤖 Primary" header (not Scout)
- [ ] `recordOutgoing` attributes message to correct SID
- [ ] `broadcastOutbound` sends to correct fellow sessions
- [ ] Cross-session outbound event shows correct `sid` field
- [ ] All 1394+ tests pass
- [ ] Concurrent tool calls from different sessions don't cross-contaminate
