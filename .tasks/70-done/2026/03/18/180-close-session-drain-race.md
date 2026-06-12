# Fix close_session drain–close race condition

**Type:** Bug fix
**Priority:** 180 (High — data loss on failure path)
**Source:** Copilot PR review #4, `close_session.ts:45`

## Problem

`close_session.ts` calls `drainQueue(sid)` **before** `closeSession(sid)`. If `closeSession()` returns `false`, the drained orphaned items are silently discarded — they were removed from the queue but never rerouted, and the session is still alive.

Current order (lines 39–44):

```typescript
const orphaned = drainQueue(sid);   // ← empties the queue
const closed = closeSession(sid);   // ← might fail
if (!closed) return { closed: false, sid };
removeSessionQueue(sid);            // ← never reached on failure
```

## Fix

Swap the order: call `closeSession(sid)` first. Only drain the queue after close succeeds.

```typescript
const closed = closeSession(sid);
if (!closed) return { closed: false, sid };
const orphaned = drainQueue(sid);
removeSessionQueue(sid);
```

This ensures the queue is never drained from a session that's still alive.

## Code Path

- `src/tools/close_session.ts` — swap `drainQueue` / `closeSession` order

## Test Changes

- Existing tests mock `closeSession` to return `true` by default, so the happy path is unaffected.
- Add a test: when `closeSession` returns `false`, verify `drainQueue` was NOT called.

## Acceptance Criteria

- [ ] `closeSession(sid)` is called before `drainQueue(sid)`
- [ ] Queue is only drained after close succeeds
- [ ] New test: `closeSession` failure does NOT trigger `drainQueue`
- [ ] All existing tests pass
- [ ] Build clean, lint clean
- [ ] `changelog/unreleased.md` updated
