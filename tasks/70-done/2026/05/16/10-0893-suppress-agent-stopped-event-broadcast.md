---
id: "10-0893"
title: "Suppress agent_event kind=stopped from Telegram service message broadcast"
type: patch
priority: 10
created: 2026-05-16
delegation: Worker
target_branch: dev
release: "7.5.1"
---

# 10-0893 — Suppress agent_event kind=stopped from Telegram service message broadcast

## Context

The Telegram bridge emits service messages for Claude Code agent lifecycle events. Currently both `kind: stopped` and `kind: compaction` (and likely `kind: started`) are broadcast. The `stopped` event fires on every normal session end — including the Curator's routine stop/restart cycle — producing high-frequency noise in the Telegram feed with no actionable signal. Overseer flagged this as a false positive on 2026-05-16.

The rule going forward:
- **`kind: compaction`** — keep broadcasting. Useful signal: session was compacted, state may have been lost.
- **`kind: stopped`** — suppress. Not useful once heartbeat/monitor infrastructure is in place; creates noise.
- **`kind: started`** — keep broadcasting (or make configurable). Useful for knowing when a session comes online.

## Acceptance criteria

1. Service messages with `event_type: "agent_event"` and `kind: "stopped"` are NOT emitted to the Telegram feed.
2. Service messages with `event_type: "agent_event"` and `kind: "compaction"` continue to be emitted unchanged.
3. Service messages with `event_type: "agent_event"` and `kind: "started"` continue to be emitted unchanged (keep for now).
4. Existing tests pass. If the filter point has tests for event routing, add a test case covering the `stopped` suppression.
5. No other event types are affected.

## Where to look

Search the TMCP source for where `agent_event` service messages are constructed and emitted. The filter should live at the emission point — not at the consumer side — so no consumer needs to know about the suppression.

Likely candidates: event bridge/router, session event handler, or wherever `kind: stopped` is assembled into a service message payload.

## Notes

- This is a patch-level change targeting 7.5.1.
- The operator's framing: "the stop is there for tracking things, not for emitting stuff." The compaction event is explicitly called out as useful; stopped is not.
- Future: when all pods have heartbeats, even started/stopped may become low-value. For now, just suppress stopped.
