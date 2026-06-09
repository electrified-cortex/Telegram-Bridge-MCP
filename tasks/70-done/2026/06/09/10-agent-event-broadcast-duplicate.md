---
id: 10-agent-event-broadcast-duplicate
title: "Agent events broadcast as duplicates (same event emitted twice)"
Created: 2026-06-09
Status: queued
Priority: 10
type: bug
Source: operator voice 70456, 2026-06-09; confirmed by Curator analysis
---

# Agent events broadcast as duplicates

## Observed behavior

Agent lifecycle events (`compacting`, `compacted`, etc.) are being emitted twice with
the identical timestamp. The `post_compact_monitor_recovery` message is also doubled.

Example from Curator session dequeue (2026-06-09):
```
id: -100090  [event] Curator: compacting   ts: 2026-06-09T11:45:48-07:00
id: -100092  post_compact_monitor_recovery
id: -100093  [event] Curator: compacting   ts: 2026-06-09T11:45:48-07:00  ← duplicate
id: -100095  post_compact_monitor_recovery  ← duplicate
```

Identical timestamps confirm this is a single event being broadcast through two
routing paths, not two separate CC instances compacting.

## Likely cause

The agent event emitter or the bridge's internal broadcast likely sends to:
1. The session's own dequeue queue (targeted)
2. The `sid: 0` ambiguous/broadcast channel

...and both land in the consuming session's dequeue because the session's dequeue
drains both paths.

## Impact

- Cosmetic noise in dequeue for consuming agents
- Operator sees apparent "double compaction" which triggers false alarm about ghost instances
- `post_compact_monitor_recovery` fires twice → monitor re-arming logic may run twice

## Fix direction

- Find where agent lifecycle events are emitted in the bridge source
- Ensure each event is sent exactly once per recipient session
- OR deduplicate on the dequeue side by event ID

## Acceptance criteria

- [ ] A `compacting` event for a single CC session appears exactly once in that session's dequeue
- [ ] `post_compact_monitor_recovery` fires exactly once per compact cycle

## Delegation / gates

Worker implements; Overseer reviews; Curator stages; operator commits.
