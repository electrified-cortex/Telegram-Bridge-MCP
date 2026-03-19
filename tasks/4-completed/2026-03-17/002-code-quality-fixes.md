# Task 002 — Code Quality Fixes (PR Review)

## Problems

Four medium-severity issues from PR #40 review.

### 2A — session_start Rollback on Failure

**File:** `src/tools/session_start.ts`
**Line:** 80
**Issue:** `createSession` + `createSessionQueue` + `setActiveSession` happen
before `sendMessage`. If the intro message fails, the session is orphaned (no
caller has the `sid`/`pin`) and `_activeSessionId` is left stale.

**Fix:** The `catch` block at the bottom of the handler already has rollback
logic (`removeSessionQueue`, `closeSession`, `setActiveSession(0)`). Verify
that ALL code paths that can throw (specifically the `sendMessage` for the
intro) are inside that try-catch. Currently they are. **Mark this comment as
resolved** — the rollback already exists.

### 2B — dequeueBatch O(N²) Performance

**File:** `src/two-lane-queue.ts`
**Line:** 88
**Issue:** `dequeueBatch()` calls `_dequeueReady()` in a loop, and
`_dequeueReady` drains + rebuilds the response lane each time. With N response
items, this is O(N²).

**Fix:** Rewrite `dequeueBatch()` to drain the response lane once, partition
into ready + not-ready in a single pass, re-enqueue not-ready items, then
dequeue one from the message lane.

**Test:** Existing `two-lane-queue.test.ts` (37 tests) covers behavior.
Add a test with 100+ response items to verify no regression.

### 2C — Animation 429 Timer Leak

**File:** `src/animation-state.ts`
**Line:** 176
**Issue:** Multiple 429 errors before the first `resumeTimer` fires can create
duplicate intervals.

**Fix:** Track the `resumeTimer` in state. Before scheduling a new one,
`clearTimeout` the existing one. On resume, only start a new `setInterval` if
`cycleTimer` is still null and the animation instance matches.

**Test:** Add a test in `animation-state.test.ts` that simulates two 429s in
rapid succession and verifies only one interval is running after resume.

### 2D — Extra Semicolon in Test

**File:** `src/tools/session_start.test.ts`
**Line:** 32
**Issue:** `});;` — extra trailing semicolon after mock block.

**Fix:** Remove the extra `;`.

## Acceptance Criteria

1. All four sub-issues resolved
2. Build + lint + tests pass
3. `dequeueBatch` is O(N) for N response-lane items
4. Animation 429 handler has no timer leak under concurrent 429s

## PR Review Comments Addressed

- `session_start.ts` line 80 (rollback)
- `two-lane-queue.ts` line 88 (O(N²))
- `animation-state.ts` line 176 (timer leak)
- `session_start.test.ts` line 32 (extra semicolon)
