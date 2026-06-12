---
id: "20-2302"
title: "Persistent animation watchdog: service message after 10 min"
type: task
priority: 20
status: queued
created: 2026-06-12
repo: Telegram-Bridge-MCP
delegation: worker
depends_on: []
---

# Persistent animation watchdog: service message after 10 min

## Background

Operator directive 2026-06-12. When an agent starts a persistent animation
(`persistent: true`) it runs indefinitely until explicitly cancelled.
Currently there is no guard against a forgotten persistent animation — the
agent may have compacted or moved on without stopping it.

Related but distinct: `tasks/icebox/70-008-animation-timeout-service-msg.md`
covers auto-cancel notification for timed (non-persistent) animations.
This task covers the persistent case only.

## Goal

If a persistent animation has been running for ≥ 10 minutes, inject a
service message into the owning session's dequeue queue warning the agent.
Then reset the 10-minute timer (so the warning fires again after another
10 minutes if the animation is still active).

The animation is NOT cancelled — this is a warn-and-continue pattern,
not a force-stop.

## Proposed service message

```json
{
  "event": "service_message",
  "content": {
    "type": "persistent_animation_running",
    "text": "[event] Persistent animation still active (10 min). Call animation/cancel if no longer needed.",
    "message_id": <animation_message_id>,
    "preset": "<preset_name_or_null>",
    "elapsed_seconds": 600
  }
}
```

## Behavior

- Timer starts when `persistent: true` animation begins
- At T+10min: inject service message, reset timer to fire again at T+20min, T+30min, etc.
- If the animation is cancelled before the timer fires: cancel the timer
- Only fires for `persistent: true` animations — timed animations already have
  their own auto-cancel path (see 70-008)

## Implementation notes

- `animation-state.ts` manages animation lifecycle; the watchdog timer should
  live here alongside the existing timeout logic
- Requires the SID to deliver the service message (same gap noted in 70-008 —
  must thread SID through from `show_animation` or store in animation state)
- Consider whether this should be configurable (`PERSISTENT_ANIMATION_WARN_MS`,
  default 600_000) or hardcoded

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-06-12
- **Verdict:** APPROVED — operator explicit sign-off ("dispatch anytime, fine to start working")
- **Review type:** adversarial-manual
- **Checked:** criteria specific and testable (5 items), scope bounded (persistent only, no cancel), delegation correct (worker), no open blockers, implementation path identified (animation-state.ts + SID threading)

## Acceptance criteria

- Persistent animation running ≥ 10 min → service message delivered to owning session
- Timer resets after each warning (warning repeats every 10 min while still active)
- Animation is NOT cancelled by this mechanism
- Cancelling the animation before 10 min: no warning fires
- Timed (non-persistent) animations: unaffected
- Test coverage for the 10-min trigger, timer reset, and cancel-clears-timer cases

## Verification

**Verdict:** APPROVED
**Date:** 2026-06-12
**Verifier:** Dispatch agent afd3abfac9c1ac277 (independent, read-only)
**Branch:** worker/animation-watchdog (1 commit squash-merged to dev)
**Tests:** 147 files / 3416+ passing — clean

### Criteria confirmed
- C1 Persistent ≥10 min → service message: `startWatchdogTimer()` via `setInterval(PERSISTENT_ANIMATION_WARN_MS)` calls `deliverServiceMessage` with `persistent_animation_running`
- C2 Timer resets (repeats every 10 min): `setInterval` fires continuously; test verifies T+20min second warning
- C3 Animation NOT cancelled: watchdog only calls `deliverServiceMessage`, never `cancelAnimation`
- C4 Cancel before 10 min → no warning: `cancelAnimation` calls `clearWatchdogTimer(sid)`; test confirms no delivery
- C5 Timed (non-persistent) animations unaffected: watchdog guarded by `if (persistent)`
- C6 Test coverage: 6 fake-timer tests in `animation-state.test.ts` covering all acceptance criteria
