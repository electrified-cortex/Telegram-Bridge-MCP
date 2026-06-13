# Bug: Middleware Identity Disconnect — AsyncLocalStorage Gets Wrong SID

## Type

Bug — Critical

## Found During

Multi-session manual testing (2026-03-18)

## Symptom

When S1 calls `send_text` with `identity: [1, pin]`, the outbound message shows "🤖 Scout" (S2's name). The message is attributed to the wrong session. Message ownership, outbound broadcasting, and cross-session events all use the wrong SID.

## Root Cause

There are **two separate identity mechanisms** that are disconnected:

1. **`identity: [sid, pin]`** — the documented API that tools expose. Validated by `requireAuth()`. Returns the correct SID.
2. **`sid` (auto-injected by middleware)** — `server.ts` L80-83 injects a hidden `sid` parameter into every tool schema. Used by the middleware to call `runInSessionContext(sid, ...)`.

Agents pass `identity` (the documented API) but NOT the hidden `sid` parameter. The middleware reads `args.sid`, finds `undefined`, falls back to `getActiveSession()` (a last-writer-wins global), and sets `runInSessionContext` with the wrong SID.

### Code Path

```text
Agent calls send_text({ identity: [1, pin], text: "hello" })
  → server.ts middleware: args.sid is undefined
  → falls back to getActiveSession() → returns 2 (S2 was last to call a tool)
  → runInSessionContext(2, handler)
    → handler: requireAuth(identity) → validates [1, pin] → returns 1 ✅
    → handler: getApi().sendMessage(...)
      → outbound proxy: getCallerSid() → reads ALS → returns 2 ❌
      → buildHeader() → "🤖 Scout" ❌
      → recordOutgoing() → trackMessageOwner(msgId, 2) ❌
```

### Affected Code

- `src/server.ts` L88-90 — middleware reads `args.sid` not `args.identity[0]`
- `src/session-context.ts` L37 — `getCallerSid()` fallback to `getActiveSession()`
- `src/outbound-proxy.ts` L33 — `buildHeader()` reads `getCallerSid()`
- `src/message-store.ts` L438 — `recordOutgoing()` reads `getCallerSid()`
- `src/tools/confirm.ts` L93, `ask.ts` L66, `choose.ts` L93 — pending check uses `getActiveSession()` instead of `getCallerSid()`

## Fix

Patch the middleware in `server.ts` to extract SID from `identity` when `sid` is absent:

```typescript
const sid = typeof args.sid === "number"
  ? args.sid
  : (Array.isArray(args.identity) && typeof args.identity[0] === "number"
    ? args.identity[0]
    : getActiveSession());
```

Also fix the pending-check in `confirm.ts`, `ask.ts`, `choose.ts` to use `getCallerSid()` instead of `getActiveSession()`.

## Acceptance Criteria

- [ ] `send_text` with `identity: [1, pin]` shows correct session name in header
- [ ] `recordOutgoing` attributes message to the identity SID
- [ ] `broadcastOutbound` sends to correct fellow sessions
- [ ] Cross-session outbound event shows correct `sid` field
- [ ] `confirm`/`ask`/`choose` pending check reads correct session queue
- [ ] All tests pass
- [ ] No regression in single-session mode (identity omitted)
