# 092 — Animation Timeout Service Message

**Priority:** 500 (Low — back burner)
**Status:** Draft
**Created:** 2026-03-18
**Note:** Operator says "cool but not that cool" — only useful when no explicit timeout was set. 10 min default is long enough that this is low-value. Revisit after animation priority stack (451) is implemented.

## Problem

When an animation times out (auto-cancels after ~60 s inactivity), the agent isn't notified. It may think the animation is still running; or it simply forgot about it.

## Proposed change

When the animation-state timeout fires and auto-cancels an animation, inject a service message into the owning session's queue:

```json
{
  "event": "service_message",
  "content": {
    "type": "animation_timeout",
    "message_id": 9649,
    "preset": "thinking",
    "elapsed_seconds": 60
  }
}
```

## Implementation

1. In `animation-state.ts`, the timeout callback currently edits the animation message to a static status.
2. Add a `deliverServiceMessage` call to the owning session's queue with event type `animation_timeout`.
3. Requires knowing the SID that owns the animation — thread through from `show_animation` or store in animation state.

## Feasibility

Medium — requires wiring `animation-state.ts` to `session-queue.ts` (they don't currently communicate). The SID must be tracked alongside each animation slot.
