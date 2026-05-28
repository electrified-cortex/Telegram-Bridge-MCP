---
Created: 2026-05-17
Status: backlog
Priority: low
Source: operator voice 2026-05-17 ~11:00 PT
---

# `help('compacted')` should include monitor-recovery breadcrumbs

## Problem

After compaction, agents lose their Monitor task (the harness task ID dies; the watcher process may persist but is no longer tied to the notification stream). The current `action(type: 'help', topic: 'compacted')` response likely covers token reattach and dequeue resume but does not enumerate monitor recovery. Agents either remember from the `telegram-participation` skill or silently go deaf.

## Acceptance Criteria

- [ ] Audit current `help('compacted')` response text to confirm whether a monitor recovery section exists.
- [ ] Add a clearly-labeled "Monitor recovery" section to the compacted help topic.
- [ ] Section enumerates exact action calls: `action(type: 'activity/file/get')` to find path, then `Monitor` tool with `persistent: true` and `timeout_ms: 3600000`.
- [ ] Hand-off chain documented: compacted → monitor → activity/file — each topic names the next step.
- [ ] No behavioral change to monitor mechanics; help text only.
