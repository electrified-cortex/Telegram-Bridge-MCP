# Fix ALS session context spoofing in server.ts middleware

**Type:** Security fix
**Priority:** 270 (High — session impersonation vector)
**Source:** Copilot PR review #5 (2026-03-19)

## Problem

In `src/server.ts` (lines 88–101), the `registerTool` middleware that wraps every tool call determines the session ID for `AsyncLocalStorage` context like this:

```typescript
const sid = typeof args.sid === "number"
  ? args.sid                              // ← preferred: UNVALIDATED
  : (Array.isArray(args.identity) && typeof args.identity[0] === "number"
    ? args.identity[0]                    // ← fallback: from identity tuple
    : getActiveSession());
```

The issue: `args.sid` is a bare number injected into every tool's schema (lines 82–87) without authentication. It takes priority over `args.identity[0]`, which comes from the authenticated `[sid, pin]` tuple.

This means a caller can pass `sid: 5` alongside `identity: [3, validPin]` and the ALS context gets set to session 5, not session 3. Any code that calls `getCallerSid()` (attribution, logging, routing helpers) sees the spoofed session ID.

## Fix

Reverse the priority so validated identity always wins:

```typescript
const sid = (Array.isArray(args.identity) && typeof args.identity[0] === "number")
  ? args.identity[0]                     // ← prefer: from validated identity
  : (typeof args.sid === "number"
    ? args.sid                            // ← fallback: injected sid (unauthenticated tools)
    : getActiveSession());
```

This preserves the `args.sid` path for tools that don't use identity (unauthenticated/bootstrap tools) while ensuring that when identity IS present, it takes precedence.

## Code Path

- `src/server.ts` — lines 88–101, the `wrappedCb` inside `server.registerTool` override

## Acceptance Criteria

- [ ] When both `args.identity` and `args.sid` are present, the ALS context uses `args.identity[0]`
- [ ] When only `args.sid` is present (no identity), the ALS context uses `args.sid` (backward compat)
- [ ] When neither is present, falls back to `getActiveSession()`
- [ ] Typecheck clean — `pnpm typecheck`
- [ ] Lint clean — `pnpm lint`
- [ ] Existing tests pass — `pnpm test`
- [ ] `changelog/unreleased.md` updated under `## Fixed`
