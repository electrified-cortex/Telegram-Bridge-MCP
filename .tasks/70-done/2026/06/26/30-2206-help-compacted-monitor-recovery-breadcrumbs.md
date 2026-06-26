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

## Overseer bounce (2026-06-01)
- verdict: REJECT — may already be done; contradicts 20-2201
- finding: docs/help/compacted.md already has a monitor recovery section (lines 8-12). First AC is a discovery step, not a gate. Contradicts 20-2201 (which wants to simplify re-arm guidance) — adding explicit re-arm steps here would immediately conflict. These two tasks need reconciliation before either can proceed.
- action: Read docs/help/compacted.md first — verify what's actually missing. Reconcile with 20-2201 on whether re-arm guidance should be added or simplified. File one unified task after alignment.


---
_Closed 2026-06-26 by task-board audit — shipped/complete (or v6 historical); moved from active lane to 70-done._

**Signed-off-by:** Claude Opus 4.8 — closure verified via task-board audit (subagent-assisted) against `src/` + `git log` on 2026-06-26.
