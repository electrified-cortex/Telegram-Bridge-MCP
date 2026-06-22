# TMCP: Warn on dequeue(max_wait:0) with active activity subscription

**Source:** Operator directive 2026-06-22 (dogfood session)  
**Routes to:** TMCP `.tasks/00-ideas/` via Overseer  
**Priority:** P1 — behavioral guard; prevents the drain-and-idle anti-pattern at runtime

---

## Problem

When an agent has an active activity subscription (SSE via `activity/listen` OR file-watch via `activity/file/create`), calling `dequeue(max_wait: 0)` is the anti-pattern. The agent should call blocking `dequeue()` (session default) and loop until `timed_out: true`. The subscription handles waking the agent for the next cycle.

This went undetected today (2026-06-22): Curator called `max_wait: 0` on every SSE wake because memory encoded it as the "drain-and-idle" idiom. No runtime signal corrected it.

**Related spec:** `tmcp-dequeue-pattern-behavioral-nudge.md` covers a different case (re-polling after `timed_out`). This spec covers the upstream case: using `max_wait: 0` at all while subscribed.

---

## Proposed behavior

When a session with an **active activity subscription** (SSE or file-watch) calls `dequeue(max_wait: 0)`:

1. Serve the call normally (do not block it — startup drain is a valid exception).
2. **Inject a `behavior_nudge` service message** into the response alongside any updates:

```json
{
  "event": "service_message",
  "content": {
    "type": "service",
    "event_type": "behavior_nudge_max_wait_zero_with_subscription",
    "text": "⚠️ You called dequeue(max_wait: 0) while an activity subscription is active. This is the drain-and-idle anti-pattern: it bypasses the blocking loop and prevents idle detection. Correct pattern: dequeue() with NO max_wait → handle → repeat until timed_out: true. Your subscription wakes you for the next cycle — you do not need instant polls."
  }
}
```

3. **Grace rule:** suppress the nudge if:
   - This is the first `max_wait: 0` call since session start (startup drain — R3)
   - OR fewer than 2 `max_wait: 0` calls since last subscription arm (one-shot checks are acceptable)

4. **Nudge once per session then back off** — do not spam on every subsequent `max_wait: 0` call in the same session. Re-arm after subscription is re-established.

---

## Acceptance criteria

- AC1: Session with SSE active calls `dequeue(max_wait: 0)` twice → second call includes `behavior_nudge_max_wait_zero_with_subscription` service message in response
- AC2: First `max_wait: 0` call after `session/start` (startup drain) → NO nudge
- AC3: Session WITHOUT active subscription calls `dequeue(max_wait: 0)` → NO nudge (polling valid)
- AC4: Nudge fires at most once per subscription lifetime (re-armed on `activity/listen` re-call)

---

## Implementation notes

- Track per-session: `maxWait0CallCount: number` (reset on subscription arm)
- Active subscription check: session has a live SSE subscriber OR a registered file-watch path
- Nudge type: `behavior_nudge` family — already suppressed from SSE notify trigger (won't wake the monitor loop, arrives as in-band update only)
- Complements `behavior_nudge_dequeue_pattern` (re-poll after timeout); these cover different failure modes

---

## Companion cleanup

Once this is implemented, the standing memory fix (2026-06-22) in `feedback_never_explicit_max_wait.md` remains as the agent-side guard. Bridge-side + memory-side = belt and suspenders.
