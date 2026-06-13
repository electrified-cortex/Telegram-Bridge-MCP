# Task 036 — Governor Auto-Assignment Bug on Reconnect

**Priority:** 10 (critical)
**Branch:** `task/036-governor-reconnect`

## Problem

When the overseer (SID 1, governor) closes its session and reconnects, it gets a new SID (e.g., SID 3). The governor auto-assignment in `session_start.ts` always picks the **lowest SID** — which is now the Worker (SID 2). All ambiguous operator messages route to the Worker instead of the Overseer.

This was observed live on 2026-03-20: after `close_session(1)` → `session_start(name: "Overseer", reconnect: true)` → SID 3, the server assigned Worker (SID 2) as governor. Operator messages 11543–11545 (no `reply_to`) were routed to Worker's queue. Overseer's `dequeue_update` returned empty/timed_out while the operator's messages accumulated in the wrong queue.

### Sequence

1. Overseer starts as SID 1 (governor). Worker joins as SID 2.
2. Overseer calls `close_session`. `remaining.length === 1` → `setGovernorSid(0)` (line 61).
3. Overseer reconnects → gets SID 3 (new session, higher than Worker's SID 2).
4. `sessionsActive === 2` triggers auto-assignment (line 225): `lowestSid = Math.min(2, 3) = 2` → Worker becomes governor.
5. Ambiguous messages go to Worker. Overseer is deaf.

## Root Cause

`session_start.ts` line 224–227:

```ts
if (session.sessionsActive === 2) {
  const lowestSid = Math.min(...allSessions.map(s => s.sid));
  setGovernorSid(lowestSid);
}
```

Lowest-SID is the wrong heuristic. SIDs are monotonically increasing — a reconnecting session always gets a higher SID than surviving ones.

## Proposed Fix

When `sessionsActive` goes from 1 → 2, **prompt the operator** to pick the governor using inline buttons (same pattern as the `/governor` command). The operator already approves 2nd+ sessions via color buttons, so this is a natural extension.

**Alternative (simpler):** When `sessionsActive === 2` and the joining session has `reconnect: true`, assign the **reconnecting** session as governor instead of the lowest SID. Rationale: a reconnecting session is resuming a previous role, and the surviving session continued without governor responsibilities during single-session mode.

The implementation should choose whichever approach the operator prefers. Both are valid.

## Files to Change

| File | Change |
|---|---|
| `src/tools/session_start.ts` | Lines 224–227: replace lowest-SID heuristic |
| `src/tools/session_start.test.ts` | Update/add tests for governor assignment on reconnect |
| `src/tools/close_session.ts` | No changes expected (governor clear on 2→1 is correct) |

## Source References

- `src/tools/session_start.ts:224–227` — auto-assignment: `setGovernorSid(lowestSid)`
- `src/tools/close_session.ts:61–69` — 2→1 transition: `setGovernorSid(0)`
- `src/tools/session_start.ts:248–276` — session_orientation with governor info
- `src/built-in-commands.ts:363–395` — `/governor` panel and `refreshGovernorCommand`

## Completion

Branch: `task/036-governor-reconnect` (pushed to remote, targets dev)

**Fix applied in `src/tools/session_start.ts`:**
- Changed governor auto-assignment when `sessionsActive === 2`
- When `reconnect: true`: joining session takes governor seat (resumes prior role)
- When `reconnect: false`: retains lowest-SID heuristic (original session is anchor)

**Test added in `src/tools/session_start.test.ts`:**
- `"assigns reconnecting session as governor when second session reconnects"` — simulates SID 2 surviving + SID 3 reconnecting, verifies `setGovernorSid(3)` not `setGovernorSid(2)`

TypeScript clean, all 58 session_start tests pass. Commit: `fix: assign reconnecting session as governor on rejoin (#036)`
