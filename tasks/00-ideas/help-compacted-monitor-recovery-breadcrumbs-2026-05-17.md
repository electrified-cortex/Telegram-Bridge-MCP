---
type: idea
status: parked
filed-by: Curator
date: 2026-05-17
origin: operator voice 2026-05-17 ~11:00 PT
priority: P3 (UX polish; informs agent recovery after compaction)
---

# `action(type: 'help', topic: 'compacted')` should hand back monitor-recovery breadcrumbs

## Operator observation

Agents lose their activity-file Monitor task across compaction (the harness task ID dies; the watcher process may persist but is no longer tied to the agent's notification stream). When an agent calls `action(type: 'help', topic: 'compacted')`, the response should explicitly call out monitor loss and chain to recovery actions:

> "Monitors typically unravel here. To reconnect: call `action(type: 'activity/file/get')` to find your file path, then re-arm via the `Monitor` tool with `persistent: true` and `timeout_ms: 3600000`. For full procedure: `action(type: 'help', topic: 'activity/file')`."

## Why

Today's compacted-help (if it exists; verify) likely covers token reattach and dequeue resume but doesn't enumerate monitor recovery. Agents either remember from `telegram-participation` skill or go deaf silently. The breadcrumb chain (compacted → monitor → activity/file) makes the recovery deterministic instead of memory-dependent.

## Scope sketch

- Audit current `action(type: 'help', topic: 'compacted')` response text
- Add a clearly-labeled "Monitor recovery" section
- Each step cites the exact action call the agent should make next
- Hand-off chain: compacted → monitor → activity/file — each topic naming the next

## Pairs with

- `tasks/00-ideas/smart-service-message-injection-2026-05-17.md` — broader theme: bridge nudges agents based on observed lifecycle events.
- `tasks/10-drafts/activity-aware-kick-timing-2026-05-17.md` — same area (activity-file lifecycle).

## Status

Parked. Cheap UX polish, no architectural footprint. Address as part of help-topic refresh pass.
