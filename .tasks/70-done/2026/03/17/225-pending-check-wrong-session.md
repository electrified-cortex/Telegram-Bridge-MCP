# Bug: Pending Check in Blocking Tools Uses Wrong Session

## Type

Bug — High

## Found During

Multi-session isolation audit (2026-03-18)

## Description

The blocking interactive tools (`confirm`, `ask`, `choose`) check for pending updates before executing. They use `getActiveSession()` instead of `getCallerSid()` to determine which session's queue to check.

### Affected Files

- `src/tools/confirm.ts` L93: `const sid = getActiveSession();`
- `src/tools/ask.ts` L66: `const sid = getActiveSession();`
- `src/tools/choose.ts` L93: `const sid = getActiveSession();`

## Symptom

S1 calls `confirm("Ready?")`. The pending check reads `getActiveSession()` which returns S2 (because S2 called a tool more recently). If S2's queue has items, S1 gets a false `PENDING_UPDATES` error. If S1's queue has items, the check misses them.

## Fix

Replace `getActiveSession()` with `getCallerSid()` in all three files:

```typescript
const sid = getCallerSid();
```

This reads from `AsyncLocalStorage` (set by the middleware wrapper), falling back to `getActiveSession()` only in single-session mode.

**Note:** This fix depends on task 500 (middleware identity disconnect) being resolved first. If the middleware still sets the wrong SID in ALS, `getCallerSid()` would return the wrong value too.

## Acceptance Criteria

- [ ] `confirm`/`ask`/`choose` check the calling session's queue, not the global active session
- [ ] No false `PENDING_UPDATES` errors when another session has queued items
- [ ] No missed pending updates in the caller's own queue
- [ ] All tests pass
