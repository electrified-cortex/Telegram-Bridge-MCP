---
Created: 2026-06-10
Status: stamped-pass
Gate: PASS (R4 — 2026-06-10)
Priority: 10
Target: 7.10.0
Delegation: foreman → worker
Branch: worker/10-2303-five-min-active-re-kick
Dev-branch: dev-7.10.0
Spec: tasks/10-drafts/notification-wake-contract-SPEC.md §5-a
---

# 10-2303: 5-Minute Active Re-Notify — File-Monitor Path (§5-a)

## Problem

`LOCKOUT_DEFAULT_MS = 300_000` at `src/tools/activity/file-state.ts:67` is **suppression-only** — it prevents duplicate notifications for 5 min after a notification fires. It does NOT proactively re-notify after 5 min of inactivity with pending content. A stopped agent with pending queue content and no new inbound messages gets: initial notification → silence forever.

Note: divergence D (timed_out exits not releasing lockout) was **already fixed by BT-2301** (see `dequeue.ts:511`). Do not re-fix it.

Note: divergence E (`hasPendingUserContent` excludes reminders) is deferred to §5-b. Add a `// TODO §5-b: include reminder types once §5-b lands` comment at the re-notify condition site. Do not change the function.

**SSE path scope:** This task builds the re-notify timer for the **file-monitor path only** (`notifyIfAllowed`). The SSE subscriber is NOT called from `file-state.ts` — that would create a circular import (`file-state.ts` → `sse-endpoint.ts` → `session-queue.ts` → `file-state.ts`). Task 10-2305 hooks the re-notify timer into SSE via the `notifySession` dispatcher. AC-11 SSE parity coverage is in 10-2305.

## Relevant code (post 10-2302 rename — all "kick" → "notify")

- `src/tools/activity/file-state.ts` — `ActivityFileState` interface, `notifyIfAllowed()`, `releaseNotifyLockout()`, `notifyLockedUntil`, `pendingRetryHandle` (naming precedent for new timer field), `resetActivityFileStateForTest()`
- `src/tools/dequeue.ts:333, :356` — `releaseNotifyLockout(sid)` on content-returning exits
- `src/session-queue.ts:162` — `hasPendingUserContent(sid)`
- Test file: `src/tools/activity/file-state.test.ts`

## Design (from spec §5-a — do not deviate)

**One clock, not two.** The re-notify is built ON the existing lockout:

1. After a notification, the lockout suppresses re-notify for `LOCKOUT_DEFAULT_MS` — **no change to existing behavior**.
2. At lockout time: register a `setTimeout` (stored in a new `pendingReNotifyHandle` field on `ActivityFileState`, following the same pattern as `pendingRetryHandle`) to fire when `notifyLockedUntil` expires.
3. When the timer fires: if `hasPendingUserContent(sid)` is still true → call `fireRevaluationNotify(sid)` (the existing private function at line 256; already handles `touchInFlight` check and sets a new lockout). Do NOT call `notifyIfAllowed` — it would re-classify by source, which is wrong for a system-initiated re-notify. `fireRevaluationNotify` is in the same file (accessible directly).
4. After that single re-notify: silence. No further notification until agent dequeues.
5. **ALL sites that reset or reassign `notifyLockedUntil` to null must also cancel `pendingReNotifyHandle`** (`clearTimeout(entry.pendingReNotifyHandle); entry.pendingReNotifyHandle = null`). Enumerated sites in `file-state.ts`:
   - `releaseNotifyLockout` (line ~348: `entry.notifyLockedUntil = null`)
   - `handleSessionStopped` (line ~411: `entry.notifyLockedUntil = null`) — **critical**: without cancel, old timer fires after stop/restart and double-touches the new entry
   - `resetNotifyGateState` (line ~373: clears lockout on reconnect)
   - `replaceActivityFile` (line ~462: new entry must initialize `pendingReNotifyHandle: null`; cancel old timer from prior entry)
   - `clearActivityFile` — safe to omit (guard `if (!entry) return` in `fireRevaluationNotify` handles dead entry), but cancel for cleanliness
6. `resetActivityFileStateForTest()` must also cancel `pendingReNotifyHandle` to prevent timer bleed between tests.

**On `setTimeout`:** The timer lives INSIDE the lockout state machine (registered and cancelled by the same code that manages `notifyLockedUntil`). The constraint is no new independent timer loops outside this mechanism.

## Acceptance Criteria

Tests go in `src/tools/activity/file-state.test.ts`. Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` (pattern from `src/animation-state.test.ts`).

- [ ] **AC-5**: Set up a parked agent (file monitor). Notify it. Agent does NOT call `dequeue` (goes idle — no `dequeue` call, no stop event). Advance time via `vi.advanceTimersByTimeAsync(300_000)`. Assert the activity file is touched exactly ONE additional time (the re-notify). Advance another 300_000 ms without dequeue. Assert NO additional file touches.
- [ ] **AC-6**: Notify a parked agent. Queue drains to empty (via `dequeue`) before 5 minutes. Assert NO additional file touch fires when the 5-minute timer would have elapsed.
- [ ] **AC-7**: Agent dequeues (content-returning; not a stop event). Enqueue new content. Agent goes idle (no further `dequeue` call, no stop event). Assert a fresh 5-minute inactivity period starts (previous timer was cancelled; new timer registered). Advance 300_000 ms; assert one re-notify.
- [ ] **`resetActivityFileStateForTest` updated**: calls `clearTimeout(state.pendingReNotifyHandle)` and sets it to null. Prevents timer bleed between tests.
- [ ] **`ActivityFileState` interface updated**: new `pendingReNotifyHandle: ReturnType<typeof setTimeout> | null` field initialized to `null`.
- [ ] **TODO comment**: `hasPendingUserContent` call in re-notify condition has `// TODO §5-b: include reminder types once §5-b lands`.
- [ ] All existing `file-state.test.ts` tests still pass.
- [ ] All existing AC-1 / AC-3 / AC-4 tests still pass (no regression).

## Out of Scope

- SSE path re-notify (handled in 10-2305 — 10-2305 extends the re-notify callback to call SSE via `notifySession`).
- Configuring lockout duration per profile.
- TMCP-side monitor liveness/backstop detection (20-backlog).
- `hasPendingUserContent` reminder counting (10-2304; leave TODO comment).
- Divergence D (already fixed by BT-2301 — do not touch).

## Notes

- Target branch: `dev-7.10.0` (branch from master after PR #208 merges).
- Must complete and merge before 10-2305 starts — 10-2305 needs the `pendingReNotifyHandle` field and the timer infrastructure to extend.
