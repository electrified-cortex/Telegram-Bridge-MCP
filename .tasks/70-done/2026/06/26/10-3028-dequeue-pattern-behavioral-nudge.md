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

---

## Overseer review

- **Reviewer:** Overseer (SID 2)
- **Date:** 2026-06-25
- **Verdict:** PASS (with binding clarifications) — cleared for foreman
- **Review type:** Adversarial spec gate (close read)
- **Checked:** Behavior testable via session simulation; scope bounded (S); failure mode distinct from 10-3030; out-of-scope section clear.
- **Binding clarifications** (resolve the spec's "e.g." softness — use these EXACT values, sourced from the spec's own Implementation notes; not new decisions):
  - Threshold: nudge on **≥ 2** rapid re-polls after `timed_out`.
  - Rapid window: **< 5 seconds** between `timed_out` and the next `dequeue()`, with no intervening incoming messages.
  - `event_type`: **`behavior_nudge_dequeue_pattern`** (behavior_nudge family — already SSE-suppressed).
  - Warn **once** per session, then reset the counter (no spam).
  - Suppress when: no active Monitor on the session; only a single re-poll (grace); or messages were delivered in the same window.
- **Not checked:** implementation correctness — covered by the post-implementation PR gate.
- **Note:** Spec lacked a formal AC list + delegation field; substance is unambiguous after the clarifications above. Sibling of 10-3030 — work SEQUENTIALLY to avoid merge contention.
- **Delegation:** worker implements → foreman verifies ACs (per operator directive 2026-06-25).

---

## Verification

- **Verifier:** Foreman (adversarial review — Overseer gate)
- **Date:** 2026-06-26
- **Verdict:** APPROVED
- **Overseer review:** PASS (2026-06-26) — gate-bounce fix (memory leak) also reviewed and passed
- **Tests:** 3926/3926 pass, lint clean
- **Commits:** `caf561be` (nudge implementation), `b1f14d42` (teardown wiring + regression test)
- **Squash on dev:** `2c34349`
- **Notes:** Threshold ≥2 rapid re-polls, 5s window, SSE+file-watch paths both covered. Once-per-lifetime guard (_nudgeFiredForSession). resetDequeuePatternNudgeForSession re-arms on SSE reconnect. removeDequeuePatternNudgeState correctly wired into closeSessionById after gate-bounce fix.
