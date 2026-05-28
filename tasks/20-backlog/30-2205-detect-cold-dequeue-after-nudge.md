---
Created: 2026-05-23
Status: backlog
Priority: medium
Source: operator voice 2026-05-23 ~09:00 PT
---

# Detect cold-dequeue pattern and nudge toward blocking (hot) dequeue

## Problem

Agents that dequeue only in response to a monitor wake signal are cold-looping: each turn ends with no in-flight `dequeue()`, and every operator message costs a wake-to-agent round trip (~20-25s observed). The expected pattern is to end every turn with a blocking `dequeue(token)` so the agent is already waiting when the next message arrives.

The bridge can detect this from observed cadence per `connection_token` and surface a one-time nudge. If this Curator session (with explicit `feedback_hot_loop_90s` memory) drifted off the pattern, any agent will.

## Acceptance Criteria

- [ ] Per-session cold-pattern detection implemented: cold signature = dequeue arrives <2s after a file-kick AND `dequeue_blocked_for` <100ms; ratio over last 20 dequeues >0.8.
- [ ] Service message `behavior_nudge_cold_dequeue_pattern` defined; fires at most once per session by default.
- [ ] Burst-aware suppression: burst-drain patterns (multiple messages arriving rapidly) are not misclassified as cold.
- [ ] Heed-tracking: if agent shifts to hot dequeue within ~10 cycles after nudge, mark resolved and do not re-fire.
- [ ] If heed-tracking shows no correction after one re-nudge, go silent (max 2 fires per session).
- [ ] Telemetry-only mode enabled initially — log detections without sending; verify detection accuracy before enabling live nudges.
