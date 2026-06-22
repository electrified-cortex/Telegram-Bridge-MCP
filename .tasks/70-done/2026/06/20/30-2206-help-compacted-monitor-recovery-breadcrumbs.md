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

## Agent review (2026-06-01)
- verdict: REJECT — may already be done; contradicts 20-2201
- finding: docs/help/compacted.md already has a monitor recovery section (lines 8-12). First AC is a discovery step, not a gate. Contradicts 20-2201 (which wants to simplify re-arm guidance) — adding explicit re-arm steps here would immediately conflict. These two tasks need reconciliation before either can proceed.
- action: Read docs/help/compacted.md first — verify what's actually missing. Reconcile with 20-2201 on whether re-arm guidance should be added or simplified. File one unified task after alignment.

## Resolved (2026-06-20)
Verified: `docs/help/compacted.md` step 4 already covers SSE-A, File-A through File-D with exact action calls. Step 5 covers "other monitors". Hand-off chain is in the "For a richer refresher" section. All ACs met — no change needed. Archiving as done.

Note on 20-2201: The "stable through compaction without re-arming" premise in 20-2201 mixes two concepts — (a) the watcher process survives, and (b) the Monitor TaskCreate subscription must always be re-registered. Current docs are correct: the watcher process check (File-B/C) avoids unnecessarily restarting the watcher, but `Monitor()` must always be re-run. 20-2201 as-written would produce a regression if "nothing at compaction recovery" were taken literally. Curator must clarify 20-2201's intent before it can proceed.
