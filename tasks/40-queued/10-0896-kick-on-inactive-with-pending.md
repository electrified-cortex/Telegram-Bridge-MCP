# 10-0896 — Activity kick only when session is inactive AND has pending messages

**Priority**: 10 (STAT — fixes infinite-kick loop in v7.4.3)
**Status**: queued
**Type**: bug fix + state-model refactor
**Target release**: 7.4.4
**Target branch**: release/7.4.4
**Tags**: bug, activity-file, state-machine
**Created**: 2026-05-11 (operator-spec'd verbally)
**Delegation**: Foreman / Worker (full chain — bug-fix-small)

## Context

v7.4.3 shipped two activity-file fixes:

1. `dequeue.ts` early-return paths now reset `inflightDequeue` (10-0895)
2. `handleSessionStopped` immediately calls `doTouch` on Stop hook (10-0894)

Both fix narrow defects, but together they expose a deeper design gap:
**the kick fires unconditionally on stop or idle-timeout, regardless of
whether the session has pending messages to consume.** When a session is
its own activity-file watcher (single-agent setup), every Stop hook turn-end
generates a self-kick → harness wakes → turn ends → Stop hook fires again.
Empirically self-damped after ~3 iterations (Monitor's 1 s poll hides
sub-second mtime changes) but still a clear bug.

The F1 nit from the v7.4.3 code review (`handleSessionStopped` doesn't reset
`lastActivityAt`) belongs to the same class — both bugs collapse under one
correct design.

## Activity state model (operator spec)

Define two states per session:

- **`active`** — at least one of:
  - inflight dequeue (blocking long-poll in progress)
  - blocking interactive call (`confirm`, `ask`, `choose`)
  - tool call within the kick-debounce window (default 60 s)
- **`inactive`** — none of the above. Reached when:
  - **Stop hook fires** (`handleSessionStopped`) → immediate
  - **Idle timer expires** (kick-debounce window elapsed with no tool calls)
    → at the timer tick

**Rule:** on transition to `inactive`, peek the session's queue.

- **Pending messages exist** → call `doTouch` (kick the activity file).
- **No pending messages** → no kick. The session has nothing to consume.

No queue inspection happens while active. No second-order kicks fire on
their own — kicks are always queue-driven.

## Why this is correct

- Kicks exist to wake a session that has a message waiting. If no
  message is waiting, there is nothing to wake to.
- Stop without pending = clean shutdown, no spurious self-loop.
- Idle timer without pending = nothing happened; nothing to signal.
- The existing 60 s debounce becomes the "how long until we promote you
  to inactive" timer rather than "how long until we force-kick you."

## Acceptance criteria

### AC1 — Activity state is queue-conditional at kick site

`touchActivityFile` (debounce-expiry kick path) and
`handleSessionStopped` (stop-event kick path) both gate the final
`doTouch(sid)` call on a queue-pending check.

The peek helper already exists:

```ts
// src/session-queue.ts:122
export function hasPendingUserContent(sid: number): boolean
```

Use this (or an equivalent non-destructive peek) immediately before
every `doTouch` call. If it returns `false`, skip the touch.

### AC2 — `handleSessionStopped` resets `lastActivityAt`

Reset `entry.lastActivityAt = 0` (or `Date.now()` minus debounce — equivalent
for "let the next inbound kick immediately"). The current code leaves
`lastActivityAt` stale, so the next inbound after stop would still hit the
60 s debounce window. Folded into this fix because the queue-gate change
shifts when kicks happen and `lastActivityAt` semantics need to align.

### AC3 — State-model invariants in code

Update the file-state.ts comment block at top of file to reflect the
new state model: explicit `active`/`inactive` definitions, the
queue-gated kick rule, and the role of `lastActivityAt` /
`inflightDequeue` / `nudgeArmed` in determining `active`-ness.

No new fields required — the existing flags already encode the state
machine; only the comment + kick gate change.

### AC4 — Unit tests

Add tests under `src/tools/activity/`:

1. **Stop + empty queue → no kick.** Register activity file, fire
   `handleSessionStopped` with empty session queue, assert
   `lastTouchAt` unchanged (no doTouch).
2. **Stop + pending message → kick fires.** Register activity file,
   enqueue a text event for the session, fire `handleSessionStopped`,
   assert `lastTouchAt` advances.
3. **Debounce expiry + empty queue → no kick.** Register, advance clock
   past debounce, call `touchActivityFile` via timer, assert no doTouch.
4. **Debounce expiry + pending message → kick fires.** Register,
   enqueue, advance clock, assert doTouch fires.
5. **Stop event resets lastActivityAt.** After `handleSessionStopped`,
   `lastActivityAt` is reset such that the next `touchActivityFile`
   call with a pending message kicks immediately (no 60 s wait).

### AC5 — Manual verification

1. Restart bridge on v7.4.4.
2. Start single-session agent that is its own Monitor on its activity
   file (i.e. Curator pattern). Issue a Stop hook.
3. Confirm: no infinite kick loop. Activity file mtime stays put.
4. Send a message from operator. Confirm: kick fires immediately
   (lastActivityAt reset; queue has pending).
5. Stop hook again with queue drained. Confirm: no kick.

### AC6 — Changelog

Add to `changelog/unreleased.md` (or `changelog/<date>_v7.4.4.md`)
describing the state-model alignment + bugs subsumed.

### AC7 — Package version bump

`package.json` `version` field set to `"7.4.4"` (already done on this
branch by Curator at branch cut). Verify it's still correct after
implementation lands. Note: v7.4.3 shipped without a package.json bump
(it's still at 7.4.2 on master at branch-cut time); this fix jumps to
7.4.4 directly, leaving the missing 7.4.3 bump as a hygiene gap for a
separate ticket if anyone cares.

## Non-goals

- General refactor of the activity-file state machine beyond the kick
  gate + lastActivityAt reset.
- Cross-session "stopped" event propagation (e.g. SID 1 stops and
  pokes SID 2's file). Stop hook is per-session; this ticket keeps
  the existing per-session model.
- The `inflightDequeue` re-entry tracking from 10-0895. That fix
  remains intact; this ticket adds a layer on top.
- PreCompact/PostCompact interaction with Stop hook ordering — separate
  edge-case pass if it surfaces.

## Files in scope

- `src/tools/activity/file-state.ts` — primary change (touchActivityFile +
  handleSessionStopped + top-of-file comment).
- `src/tools/activity/file-state.test.ts` (new) — AC4 unit tests.
- `package.json` — version bump (already on branch).
- `changelog/<date>_v7.4.4.md` (new) — AC6 entry.

## Cross-references

- 10-0893 (PR #172) — first activity-file kick fix
- 10-0894 (PR #174) — stopped HTTP event handler
- 10-0895 (PR #174) — dequeue.ts inflight-flag fix
- v7.4.3 code review: `notes/release-7.4.3-code-review.md` (F1 nit captured)
- Infinite-loop verification: live witness during v7.4.3 Stop hook test
  on 2026-05-11
- session-queue.ts `hasPendingUserContent(sid)` — the peek helper

## Notes for executor

- Use the bug-fix-small chain (see workflows catalog).
- This is a **2-file core change + 1 test file + 1 changelog file**. Tight scope.
- `hasPendingUserContent` is non-destructive — safe to call from kick sites.
- Watch for the `inflightDequeue` interaction: at the moment `dequeue`
  begins returning, `inflightDequeue` is still `true` so kicks are
  suppressed anyway — but the gate-on-pending check should still pass
  cleanly because the dequeue is about to consume the message itself.
- Don't reorder existing state-machine logic. Just add the
  `hasPendingUserContent(sid)` guard immediately before each `doTouch(sid)`
  call, and zero `lastActivityAt` in `handleSessionStopped`.
