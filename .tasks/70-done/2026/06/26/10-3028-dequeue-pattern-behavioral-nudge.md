# Idea: Dequeue Pattern Behavioral Nudge

**Area:** dequeue / service-messages / behavioral guidance
**Target release:** v7.12.0 candidate

---

## Problem

Agents sometimes misunderstand or forget the correct dequeue loop pattern. A clear
signal of this: the agent calls `dequeue()` more than once immediately after a
`timed_out: true` response while an active Monitor is running.

The correct pattern with a Monitor is:
```
SSE/kick fires → dequeue() → handle → dequeue() → ... until timed_out
                 ↑ one call per wake, not a tight re-poll loop
```

After `timed_out`, the agent should simply wait for the next SSE/Monitor event —
not immediately call `dequeue()` again. Re-polling on timeout with an active
Monitor wastes tokens and indicates the agent is treating it like a polling loop
rather than an event-driven pattern.

---

## Proposed behavior

1. **Track consecutive rapid dequeue calls after timeout (with active Monitor).**
   In `dequeue.ts`, record when a `timed_out: true` is returned to a session
   that has an active Monitor subscription. If the same session calls `dequeue()`
   again within a short window (e.g. < 5 seconds) with no intervening incoming
   messages, increment a per-session counter `dequeueAfterTimeoutCount`.

2. **On the NEXT timeout, if the counter exceeds threshold (e.g. ≥ 2):**
   - And there are no other pending messages to deliver
   - Inject a `behavior_nudge` service message (already suppressed from SSE
     notify, so won't wake a Monitor): something like:
     > "Heads up: you've called dequeue() several times immediately after timeout
     > while a Monitor is active. With a Monitor running, you don't need to
     > re-poll — the Monitor will wake you when new messages arrive. Re-read
     > `help('guide')` → dequeue loop pattern."
   - Reset the counter after the nudge (warn once, not on every timeout).

3. **Do not nudge if:**
   - No active Monitor on the session (polling is expected behavior without Monitor)
   - Only one rapid re-poll (grace for a single misfire)
   - Other messages were delivered in the same window (agent may be processing
     a backlog)

---

## Implementation notes

- New per-session state: `dequeueAfterTimeoutCount: number`, `lastTimeoutAt: number`
- Threshold: configurable constant, start at 2 rapid re-polls
- Rapid window: < 5 seconds between timeout and next dequeue call
- Service message event_type: `behavior_nudge_dequeue_pattern` (already in the
  `behavior_nudge` family — already suppressed from SSE notify in session-queue.ts)
- `ONBOARDING_SSE_MONITOR_SETUP` already tells agents the correct pattern, so
  this nudge is a runtime reminder for agents that forgot or skipped onboarding

---

## Out of scope

- Tracking agents without a Monitor (polling is valid, no nudge)
- Persistent tracking across reconnects (per-session, reset on reconnect)
- Multiple nudges per session (warn once, reset counter)
