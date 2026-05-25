---
type: idea
status: parked
filed-by: Curator
date: 2026-05-23
origin: operator voice 2026-05-23T~09:00PT
related:
  - tasks/00-ideas/smart-service-message-injection-2026-05-17.md (same family — pattern-detection -> service-message nudge)
---

# Detect "always dequeue right after kick" and nudge toward hot (blocking) dequeue

## Operator observation

If an agent dequeues *only* in response to a monitor kick — i.e. each turn ends with no in-flight `dequeue()`, and the next dequeue is triggered by a wake event — the agent is *not* hot-looped. They're paying cold-wake latency on every operator message. The expected pattern is **end every turn with a blocking dequeue** so the agent is already waiting when the next message lands.

The bridge can detect this from observed dequeue cadence (per `connection_token`):

- **Cold pattern:** dequeues consistently arrive within ~1s after a file-kick / inbox event, and never time out.
- **Hot pattern:** dequeues are issued and block (sometimes timing out at default cap, sometimes returning immediately when an event lands).

Cold = under-utilized loop. Bridge surfaces a one-time nudge:

> "Noticed your dequeues only fire after a wake event. End every turn with `dequeue(token)` (no `max_wait`) so you're already in the queue when the next message arrives. Cuts cold-wake latency."

## Why this is universal, not Curator-specific

If *this* Curator session (a Curator-class agent that has the `feedback_hot_loop_90s` memory in context) drifted off the pattern, other agents — Foremen, Workers, BT, new Operators — will also drift. The fix belongs in TMCP so every session benefits automatically, not in N pod memories.

## Anti-spam constraints

- **Once per session per pattern.** Same as other onboarding service messages.
- **Threshold-gated.** Require N consecutive cold dequeues (e.g. 5+) before firing — don't nag on first observation.
- **Suppress during burst.** If operator just sent 4 voices in rapid succession, the agent legitimately drains-and-replies many times — that's not cold pattern, that's catching up. Distinguish "kick caused dequeue" from "kick caused dequeue *because no dequeue was in flight*".
- **Heeded-vs-ignored tracking.** After firing once, observe whether pattern changes. If agent shifts to hot dequeue within next M cycles -> mark heeded, don't re-fire. If it doesn't change, fire ONE more reminder phrased differently, then go silent.

## Suggested implementation sketch

Per `connection_token` ring buffer of last N (e.g. 20) dequeue events:
- `time_since_last_send` (proxy for "was there a turn gap?")
- `time_since_last_wake_event` (was there a kick within last 2s?)
- `dequeue_blocked_for` (how long this call waited before returning)

Cold dequeue signature: `time_since_last_wake_event < 2s` AND `dequeue_blocked_for < 100ms`. Ratio over window > 0.8 -> fire nudge.

## Acceptance criteria

- [ ] Cold-pattern detection implemented per session.
- [ ] Service message `behavior_nudge_cold_dequeue_pattern` defined; max one fire per session by default.
- [ ] Burst-aware suppression in place.
- [ ] Heed-tracking: if agent corrects within ~10 cycles, mark resolved.
- [ ] Telemetry-only mode initially (log detections, no send) — verify detection accuracy before enabling nudges.

## Notes

- Pairs with `smart-service-message-injection-2026-05-17.md` — both are bridge-side observability nudges. Consider unifying both under a single "agent loop coach" subsystem.
- The `dequeue` response already includes a `silence:` hint ("silence: 39s since last dequeue") — this idea is the prescriptive counterpart to that descriptive hint.

## Delegation

Curator-owned. Hand to Overseer for vetting before any worker pickup.
