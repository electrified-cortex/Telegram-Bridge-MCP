---
Created: 2026-05-17
Status: backlog
Priority: medium
Source: operator voice 2026-05-17 ~16:00 PT
---

# Smart service-message injection based on agent dequeue behavior

## Problem

Agents running `dequeue(max_wait: 0)` then yielding (returning the turn, waiting for a kick to re-enter) pay cold-wake latency on every operator message (~20-25s observed). The bridge can detect this pattern from per-session dequeue cadence and surface a one-time corrective nudge without requiring the operator to teach each new agent.

Related to `30-2205-detect-cold-dequeue-after-nudge.md` but scoped to the instant-poll-then-yield anti-pattern specifically, whereas 2205 covers the broader cold-dequeue class.

## Acceptance Criteria

- [ ] Bridge tracks per-session dequeue cadence: `max_wait` values used, time between dequeues, yield-then-poll pattern.
- [ ] After N consecutive polls with `max_wait` <= threshold (e.g. 5 polls with `max_wait` <= 1s) → fire a service message classifying the pattern and recommending blocking dequeue.
- [ ] One nudge per session (or per configurable cooldown window); no spam.
- [ ] Service message text is specific enough to be actionable (cites the corrective pattern explicitly).
- [ ] Coordinate with `activity-aware-kick-timing` work to avoid conflicting guidance.
