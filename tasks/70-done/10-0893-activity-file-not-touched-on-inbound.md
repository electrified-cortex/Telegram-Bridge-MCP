# 10-0893 — Activity file never touched on inbound message

**Priority**: 10 (high)
**Status**: draft
**Type**: bug
**Delegation**: open

## Symptom

After `action(type: 'activity/file/create')` returns a file path, the bridge does NOT append `\n` to that file when inbound messages arrive. The file stays at 0 bytes indefinitely. Monitor watchers (file-tail) get no notifications.

The message queue still works — `dequeue` returns the messages — so message ingestion is fine. Only the activity-file kick is broken.

## Reproduction

1. Start a fresh session: `action(type: 'session/start')`.
2. Register activity file: `action(type: 'activity/file/create', token)`.
3. Verify file exists, size = 0.
4. Send any inbound message from operator.
5. `dequeue(token, max_wait: 0)` — message present in queue (works).
6. Re-check activity file size — still 0.

Expected: file size > 0 after step 4 (newline appended per inbound).
Actual: file size = 0 always.

## Observed 2026-05-10 (curator session, sid=1, token=1278517)

- Activity file path: `data/activity/4259e66de9ad247740e7ffa0b810ec58`
- Multiple inbound messages received and dequeued successfully (51784, 51785, etc.)
- Activity file size remained at 0 bytes throughout

## Suspected root cause

Per `src/tools/activity/file-state.ts` (read 2026-05-09):

`touchActivityFile(sid)` is the function that appends `\n`. It is gated on:

- `entry.nudgeArmed === true`
- `entry.inflightDequeue === false`
- elapsed since `lastActivityAt` >= `kickDebounceMs`

Possible bug paths:

1. **`touchActivityFile` not called from inbound message handler.** The message-enqueue path may have lost its call to `touchActivityFile` during a refactor.
2. **`nudgeArmed` stuck false.** `setDequeueActive(sid, false)` re-arms it, but if the in-flight dequeue path doesn't go through that function on completion, the flag never flips back to true.
3. **`inflightDequeue` stuck true.** If a dequeue call errors out without calling `setDequeueActive(sid, false)` in a `finally` block, the flag stays.
4. **Debounce stale `lastActivityAt`.** If `recordActivityTouch` is called on every tool invocation by the agent (per the spec), and the agent is calling tools, the kick debounce window never expires.

## Recommended investigation

1. Add a debug log inside `touchActivityFile` at top: log `sid`, `entry.nudgeArmed`, `entry.inflightDequeue`, `now - entry.lastActivityAt`, `debounceMs`.
2. Send a fresh-session test message; check log output.
3. Identify which gate failed. Probably (3) or (4) — agent tool-call tempo (Curator runs many tool calls per turn) keeps `lastActivityAt` rolling forward.

## Empirical observation 2026-05-10

After being dormant for ~270s (during a /loop heartbeat sleep), an inbound message DID touch the activity file: file size grew from 0 to 2 bytes (two newlines). So **kicks DO fire when the agent is fully idle for the debounce window**. The bug manifests only when the agent is making tool calls during the window — every tool call cancels the pending timer (`recordActivityTouch` clears `debounceTimer`).

Concrete sequence proven:
1. Agent dormant >60s (ScheduleWakeup'd).
2. Operator sent inbound voice → `touchActivityFile` ran. `lastActivityAt` was stale (no recent tool calls). `timeSinceActivity > debounceMs`. Kick fired immediately. File grew by 1 byte.
3. Second inbound shortly after also fired (still no agent activity in between). File grew to 2 bytes.

Confirms the bug is **agent-activity-cancels-pending-timer**, not "kicks never fire." Active agents never see kicks; idle agents do.

## Hypothesis (refined per operator pushback 2026-05-10)

Earlier hypothesis ("agent tool calls extend lastActivityAt past 60s, debounce never expires") was partially correct but missed the killing detail. Re-reading `file-state.ts`:

`recordActivityTouch(sid)` is called from `dispatchBehaviorTracking` on every agent tool call. It does TWO things:

1. Update `entry.lastActivityAt = Date.now()` (extends future debounce window — this is correct/desired).
2. **Cancel any pending kick timer**: `clearTimeout(entry.debounceTimer); entry.debounceTimer = null;` (this is the bug).

The actual sequence that breaks kicks:

1. Operator sends inbound → `touchActivityFile(sid)` runs. Agent was active recently, so within debounce window. A `setTimeout` is scheduled to fire when window expires.
2. Agent makes ANY tool call → `recordActivityTouch(sid)` runs → `clearTimeout(debounceTimer)` kills the pending kick.
3. Window expires → no timer fires (was cancelled in step 2). No kick happens.

Operator confirmed empirically: "you went dormant >60s, nothing happened." Even when the agent goes idle AFTER the inbound, by then the timer is already cancelled — there's nothing left to fire.

This means: **for the kick to ever fire, the agent must be completely idle from the inbound moment through the full debounce window.** A single tool call between inbound and window-expiry cancels the kick.

Curator (and any active agent) makes many tool calls per minute (dequeues, edits, dispatches). The probability of being completely idle for 60 consecutive seconds during normal operation is near zero.

## Fix

The agent's own activity should NOT cancel a pending kick timer. `recordActivityTouch` should:

- Update `entry.lastActivityAt = Date.now()` (still useful for FUTURE kick scheduling).
- **NOT** `clearTimeout(entry.debounceTimer)`. Leave the pending timer alone.

When the timer fires, the recursive `touchActivityFile(sid)` call will re-evaluate. If by then conditions warrant a kick (e.g. now in-flight dequeue), the re-evaluation handles it correctly.

The only legitimate reason to clear the timer is when the entry itself is being replaced (`replaceActivityFile`) or cleared (`clearActivityFile`) — both of those already do their own cleanup.

## Acceptance criteria

- After session/start + activity/file/create, the registered file size grows by 1 byte per inbound message — even when the agent is making other tool calls.
- Operator-side test: agent is actively tool-calling (e.g. doing a long task), operator sends a message, kick fires within debounce window of inactivity if any (or immediately if agent has been quiet).
- Existing debounce semantics preserved for the case where multiple inbounds arrive in rapid succession (the dedup lives in the "don't reschedule if a timer is already pending" check, which stays).

## Acceptance criteria

- After session/start + activity/file/create, the registered file size grows by 1 byte per inbound message.
- Operator-side test: send 3 messages, file should grow to 3 bytes.
- Existing debounce semantics preserved for the case where multiple inbounds arrive in rapid succession.

## Related

- 10-0891 — activity-file Monitor reminder service message (related but separate, that's about prompting agents to arm Monitor, not about the kick mechanism itself)
- 10-0874 — disable healthcheck when activity-monitor active
- 10-0880 — onboarding activity-file Monitor wiring

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-10
**Criteria:** 3/3 passed
**Evidence:** Diff of fd47552d vs dev confirms clearTimeout block removed from recordActivityTouch in file-state.ts; test 4 updated to assert timer NOT cancelled on tool calls; test 11 added as regression guard. All 11 tests pass independently (vitest run confirmed, 178ms, 0 failures).
