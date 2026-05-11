# 10-0896 — Activity kick: open-gate-while-inactive + poke-debounce

**Priority**: 10 (STAT — fixes infinite-kick loop in v7.4.3 + aligns state model)
**Status**: queued
**Type**: bug fix + state-model refactor
**Target release**: 7.4.4
**Target branch**: release/7.4.4
**Tags**: bug, activity-file, state-machine
**Created**: 2026-05-11 (operator-spec'd verbally, refined open-gate model)
**Delegation**: Foreman / Worker (full chain — bug-fix-small)

## Context

v7.4.3 shipped two activity-file fixes:

1. `dequeue.ts` early-return paths now reset `inflightDequeue` (10-0895)
2. `handleSessionStopped` immediately calls `doTouch` on Stop hook (10-0894)

Both fix narrow defects, but together they expose a deeper design gap:
**the kick fires unconditionally on stop or idle-timeout, regardless of
whether the session has pending messages to consume.** When a session is
its own activity-file watcher (single-agent setup), every Stop hook
turn-end generates a self-kick → harness wakes → turn ends → Stop hook
fires again. Empirically self-damped after ~3 iterations (Monitor's 1 s
poll hides sub-second mtime changes) but still a clear bug.

The F1 nit from the v7.4.3 code review (`handleSessionStopped` doesn't
reset `lastActivityAt`) belongs to the same class — both bugs collapse
under one correct design.

## Activity state model (operator spec)

### States

- **`active`** — at least one of:
  - inflight dequeue (blocking long-poll in progress)
  - blocking interactive call (`confirm`, `ask`, `choose`)
  - tool call within the kick-debounce window (default 60 s,
    `lastActivityAt + kickDebounceMs > now`)
- **`inactive`** — none of the above. Reached when:
  - **Stop hook fires** (`handleSessionStopped`) → immediate transition
  - **Idle timer expires** (kick-debounce window elapsed with no tool
    calls) → at the timer tick

### The open-gate kick rule

Think of the kick as a **gate**.

- **Gate is OPEN** while the session is `inactive`. Inbound messages
  walking through an open gate poke the activity file.
- **Gate is CLOSED** while the session is `active`. Inbound messages
  arriving with the gate closed do not poke (the active session will
  consume them via its in-flight dequeue or next dequeue call).

### The poke-debounce (don't spam-signal)

A poke itself is debounced. Default `pokeDebounceMs = kickDebounceMs`
(60 s). If we just told you "you have a message," we don't tell you
again 1 s later — you already know.

The poke-debounce window **resets** at every `active → inactive`
transition. Concretely: each fresh inactive transition starts a new
"first poke is free" window. Subsequent pokes within the same
inactive window are gated by `(now - lastPokeAt) >= pokeDebounceMs`.

### Stop-hook special case

A Stop hook is itself an `active → inactive` transition. So it resets
the poke-debounce — if there are pending messages it pokes immediately,
**even if the previous poke was recent**. Operator's wording: "if you
go inactive and there's still more messages, it's still going to be
like, hey, dude, you still got a message."

### Universal pre-condition

A poke fires ONLY IF the session's queue has pending user content
(`hasPendingUserContent(sid)` returns true). No pending = no poke. This
kills the infinite Stop-hook self-kick when the session is its own
monitor.

## Why this is correct

- Kicks exist to wake a session that has a message waiting. If no
  message is waiting, there is nothing to wake to.
- Stop without pending = clean shutdown, no spurious self-loop.
- Idle-timer expiry without pending = nothing happened, nothing to
  signal.
- Poke-debounce within an inactive window prevents spam during message
  bursts; the agent already knows there's a message after the first poke.
- Reset on active→inactive transition lets us re-signal after the agent
  served the queue and went idle again.

## Acceptance criteria

### AC1 — Open-gate model wired at kick sites

`touchActivityFile` (inbound + trailing-timer path) and
`handleSessionStopped` (stop-hook path) both apply the universal
pre-condition and the poke-debounce as specified above. A single
centralized helper is preferred (e.g. `shouldPoke(sid, {forceReset})`)
to keep both call sites identical in behavior.

The peek helper already exists:

```ts
// src/session-queue.ts:122
export function hasPendingUserContent(sid: number): boolean
```

Use this (or an equivalent non-destructive peek) immediately before
every `doTouch` call.

### AC2 — Poke-debounce tracking

Track per-session `lastPokeAt` (the existing `lastTouchAt` field
suffices — it's already updated by `doTouch`). Add the poke-debounce
window check at every poke site.

The poke-debounce window resets when:

- `setDequeueActive(sid, false)` fires (existing dequeue-complete
  re-arming path).
- `handleSessionStopped(sid)` fires (Stop hook).
- The trailing-timer fires AND no poke results (the transition to
  inactive happened, but the queue was empty — next inbound while
  inactive should be free to poke).

Implementation hint: clearing `lastTouchAt = null` on these reset
points cleanly expresses "first poke after this point is free."

### AC3 — `handleSessionStopped` zeroes `lastActivityAt`

Reset `entry.lastActivityAt = 0` inside `handleSessionStopped` so the
next inbound message after stop sees `(now - lastActivityAt) >>
kickDebounceMs` and is immediately classified `inactive`. Without this
the next inbound would still hit the 60 s debounce window even though
the agent has clearly stopped.

### AC4 — `nudgeArmed` interaction

Keep `nudgeArmed` as a safety belt (one poke per arming-cycle), but
ensure all three reset points re-arm it:

- `setDequeueActive(sid, false)` — re-arm (existing behavior, unchanged).
- `handleSessionStopped(sid)` — re-arm (existing behavior, unchanged).
- Trailing-timer fire with no resulting poke — re-arm (NEW). Without
  this, a missed poke (empty queue at timer fire) leaves the session
  permanently un-armed until the next dequeue.

### AC5 — State-model invariants in code comments

Update the file-state.ts comment block at top of file to reflect the
new state model: explicit `active`/`inactive` definitions, the
open-gate kick rule, the poke-debounce, and the Stop-hook exception.
Drop any stale references to the old "unconditional kick on stop"
model.

### AC6 — Unit tests

Add tests under `src/tools/activity/file-state.test.ts` (create or
extend). Required cases:

1. **Stop + empty queue → no poke.** Register activity file, fire
   `handleSessionStopped` with empty session queue, assert
   `lastTouchAt` unchanged.
2. **Stop + pending message → poke fires.** Register, enqueue text
   event, fire `handleSessionStopped`, assert `lastTouchAt` advances.
3. **Stop + pending + recent poke → poke fires (Stop overrides
   debounce).** Register, enqueue, poke once, immediately fire
   `handleSessionStopped`, assert second `lastTouchAt` advance.
4. **Inbound while inactive + empty queue → no poke.** Register,
   ensure inactive, simulate inbound (`touchActivityFile`), assert no
   poke.
5. **Inbound while inactive + pending + cold debounce → poke fires.**
   Fresh inactive transition (lastTouchAt null), inbound, assert poke.
6. **Inbound while inactive + pending + recent poke (< debounce) → no
   poke.** Poke at t=0, advance clock 5 s, inbound, assert no poke.
7. **Inbound while inactive + pending + stale poke (>= debounce) →
   poke fires.** Poke at t=0, advance past debounce window, inbound,
   assert poke.
8. **Active→inactive transition resets poke-debounce.** Poke at t=0,
   simulate dequeue complete (resets), inbound, assert poke fires
   immediately (no debounce wait).
9. **Stop hook zeroes lastActivityAt.** After `handleSessionStopped`,
   next inbound classifies session as inactive even if previous tool
   call was < 60 s ago.
10. **Trailing-timer with empty queue re-arms.** Register, enqueue
    while active, advance clock to fire trailing timer, drain queue
    before timer fires, assert no poke + nudgeArmed=true after.

### AC7 — Manual verification

1. Restart bridge on v7.4.4.
2. Start single-session agent (Curator pattern) that is its own
   activity-file monitor.
3. Issue a Stop hook → confirm no infinite kick loop. mtime stays put.
4. Send a message from operator → confirm: kick fires immediately
   (queue has pending, lastTouchAt was reset by Stop transition).
5. Send a SECOND message within 5 s, before dequeue → confirm: no
   second kick (poke-debounce active).
6. Wait 60 s+, send a third message → confirm: kick fires (debounce
   elapsed).
7. Call dequeue (drain) → after dequeue completes, send another
   message → confirm: kick fires immediately (dequeue reset the
   debounce).

### AC8 — Changelog

Add to `changelog/<date>_v7.4.4.md` (new file, follow existing
release-flow naming convention) describing:

- Bug fix: infinite Stop-hook self-kick when session monitors own file.
- State-model rewrite: open-gate kick with poke-debounce.
- Folded F1 nit: lastActivityAt reset on Stop.

### AC9 — Package version bump

`package.json` `version` field set to `"7.4.4"` (already done on this
branch at branch cut). Verify still correct after implementation
lands. Note: v7.4.3 shipped without a package.json bump (master still
at 7.4.2 at branch-cut time); this fix jumps directly to 7.4.4 —
missing 7.4.3 bump is a hygiene gap for a separate ticket.

## Non-goals

- General refactor of the activity-file state machine beyond the
  open-gate model and the reset points listed above.
- Cross-session "stopped" event propagation (e.g. SID 1 stops and
  pokes SID 2's file). Stop hook is per-session; keep current model.
- PreCompact/PostCompact interaction with Stop hook ordering.
- Configurable `pokeDebounceMs` separate from `kickDebounceMs`. Use
  the same value for now; introduce a separate config knob only if a
  follow-up requires divergence.

## Files in scope

- `src/tools/activity/file-state.ts` — primary change (state-model
  comment + new `shouldPoke` helper + `touchActivityFile` +
  `handleSessionStopped` + `setDequeueActive` reset paths).
- `src/tools/activity/file-state.test.ts` (new or extend) — AC6.
- `package.json` — version bump (already on branch).
- `changelog/<date>_v7.4.4.md` (new) — AC8.

## Cross-references

- 10-0893 (PR #172) — first activity-file kick fix
- 10-0894 (PR #174) — stopped HTTP event handler
- 10-0895 (PR #174) — dequeue.ts inflight-flag fix
- v7.4.3 code review: `notes/release-7.4.3-code-review.md` (F1 nit)
- Infinite-loop verification: live witness during v7.4.3 Stop hook
  test on 2026-05-11
- session-queue.ts `hasPendingUserContent(sid)` — peek helper

## Notes for executor

- Use the bug-fix-small chain (workflows catalog).
- Core change is a **2-file core + 1 test file + 1 changelog**.
- `hasPendingUserContent` is non-destructive — safe to call from kick
  sites.
- The poke-debounce default == kickDebounceMs == 60 s. Don't introduce
  a new config knob unless needed.
- Watch for the existing `inflightDequeue` short-circuit at the top of
  `touchActivityFile` — leave it. The active/inactive predicate
  collapses to that flag plus `lastActivityAt`.
- Resist over-refactoring: the existing state-machine bones are
  correct, this ticket only changes the kick-decision logic and the
  reset/re-arm points.
