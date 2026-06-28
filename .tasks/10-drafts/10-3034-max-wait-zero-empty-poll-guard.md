# 10-3034 — Correct max_wait:0 consecutive-empty-poll guard (7.16)

## Status
draft

## Background
10-3030 (removed in 7.15 via 10-3033) had the right concept but wrong trigger condition.
It fired a nudge whenever max_wait:0 was called while a subscription was active — too broad.
`max_wait:0` is legitimate for startup drain loops and any time there is content in the queue.

## Correct guard condition
Fire a nudge only when:
1. Agent calls `max_wait:0` → result is **empty** (no content, pending = 0)
2. Agent calls `max_wait:0` **again** without switching to blocking mode

"Consecutive empty max_wait:0 polls" = the anti-pattern. Agent got nothing, yet polls again
instead of calling `dequeue()` without `max_wait` to wait for a real notification.

## YAGNI constraints
- Simple counter: `_emptyMaxWait0Count: Map<number, number>` per session
- Increment on: empty `max_wait:0` exit (pending = 0, no content)
- Reset on: any content-returning dequeue exit (any max_wait value)
- Reset on: any `max_wait > 0` call
- Fire nudge on: count >= 2 (second consecutive empty poll)
- Do NOT reset on subscription arm (unnecessary — counter resets on content naturally)
- Keep `removeMaxWait0State` in `session-teardown.ts` for cleanup

## Message text (proposed)
"Multiple consecutive empty max_wait:0 polls. When pending is 0, switch to dequeue() without
max_wait — your subscription wakes you when messages arrive. Polling an empty queue is wasteful."

## Notes
- 10-3033 removed the broken implementation cleanly; this task re-adds the correct one
- Do NOT restore `resetMaxWait0NudgeState` calls in activity/create.ts or activity/listen.ts (YAGNI)
- Adversarial review must include design-validity check: does the nudge fire only on the anti-pattern?


---
> ⚠️ **AUDIT 2026-06-26:** Background is INCORRECT — 10-3030 was NOT removed in 7.15; it was re-shipped (broad trigger) in v7.17.0 (commit dcf6ca9d). The consecutive-empty-poll refinement (_emptyMaxWait0Count, count>=2) is still unbuilt and still wanted.
