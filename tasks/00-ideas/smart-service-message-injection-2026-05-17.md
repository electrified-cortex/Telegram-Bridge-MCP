---
type: idea
status: parked
filed-by: Curator
date: 2026-05-17
origin: operator voice 2026-05-17T~16:00Z
related:
  - tasks/10-drafts/activity-aware-kick-timing-2026-05-17.md (depends-on; coordinate after kick-timing ships)
---

# Smart service-message injection based on agent dequeue behavior

## Operator observation

If an agent's dequeue pattern is `dequeue(max_wait: 0)` then yield (return turn, harness idle until kick), every operator message costs an extra tool call to drain. The bridge can detect this pattern from observed dequeue cadence and surface a service message advising the agent: "noticed you're doing instant-poll dequeues then yielding — switch to blocking dequeue (longer max_wait) to stay in the loop and avoid harness wake-up tax."

## Why it matters

Cold-wake latency from kick to agent reply is ~20-25s per pattern observed in 2026-05-17 session (host-side instrumented). Each redundant tool-call cycle compounds it. A bridge-side nudge would catch and correct this without operator having to teach every new agent.

## Scope sketch (not a spec)

- Bridge tracks per-session dequeue cadence: max_wait values used, time between dequeues, yield-then-poll patterns
- After N polls in a row with max_wait <= some threshold (e.g. 5 polls with max_wait <= 1s) → fire a service message classifying the pattern + recommending the fix
- One-shot per session (or per cooldown window); don't spam
- Service-message text needs to be specific enough to be actionable

## Pairs with

- `activity-aware-kick-timing-2026-05-17.md` (in 10-drafts) — that spec makes kicks more responsive; this idea makes agents use kicks less in the first place. Both pull in the same direction (lower latency, fewer redundant cycles).
- `tasks/00-ideas/show-typing-service-message-miscalibration-2026-05-05.md` — similar shape (re-tune existing nudges based on observed agent behavior).

## Status

**Parked.** Operator wants kick-timing PRD shipped first; revisit this as a separate feature task after.
