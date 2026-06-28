---
title: "TMCP: Add stale_after parameter to checklist to trigger reminder on pending steps"
id: 10-3074
priority: P3
status: draft
category: Feature
filed: 2026-06-28
source: TG 81020
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-checklist-stale
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

## Refinement needed

- date: 2026-06-28
- verdict: NEEDS REFINEMENT (original bounce)
- findings resolved in this version:
  1. ✅ Added delegation frontmatter (`repo`, `branch_target`, `agent_type`, `model_class`, `source`)
  2. ✅ AC7 split: unit test for timer logic + separate integration test spec (in-process, mocked timer advancing past threshold, expect dequeue event; NOT relying on real-time elapsed)
  3. ✅ `source` field added (TG 81020)

# Stale Checklist Reminder

## Problem

Agents create checklist messages but forget to update them as steps complete. No mechanism currently exists to remind agents of stale checklists. A checklist created but never updated through completion leaves the operator without visibility.

## Proposed Feature

Add optional `stale_after` parameter to `send(type: "checklist")`:

```
send(type: "checklist", title: "...", steps: [...], stale_after: 7200)
```

- `stale_after`: seconds after last update before the bridge fires a reminder to the owning session
- Bridge tracks checklist creation time and last `checklist/update` call timestamp
- If `stale_after` elapses without an update AND checklist still has pending/running steps, bridge fires a reminder event to the session's dequeue queue
- Reminder text: "Checklist '{title}' (msg {message_id}) has not been updated in {elapsed}. {N} steps still pending."

## Acceptance Criteria

1. [ ] `send(type: "checklist")` accepts optional `stale_after` integer (seconds)
2. [ ] Bridge tracks last-updated timestamp per checklist message
3. [ ] When stale_after elapses, bridge fires reminder to owning session via dequeue
4. [ ] Reminder is suppressed if all steps are in terminal state (done/failed/skipped)
5. [ ] `checklist/update` resets the stale timer
6. [ ] No reminder fires if `stale_after` not set (opt-in, not default)
7. [ ] Unit test: stale timer logic fires at correct threshold (mock time, inject fake clock, advance past `stale_after`, assert reminder enqueued)
8. [ ] Integration test: in-process test with mocked timer advancing past `stale_after` threshold produces a `dequeue`-visible reminder event with correct `title`, `message_id`, and pending step count (no real-time elapsed required)

## Notes

- Low priority — improvement not blocker
- Related: agents can currently work around this by setting a `reminder/schedule` manually when creating a checklist
- Alternative simpler approach: checklist creation auto-registers a `last_sent` reminder

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial re-gate (post-refinement)
- checked: ACs 1-8 all binary+testable (AC7: mock clock + assert enqueued; AC8: in-process mocked timer → dequeue event with correct fields), scope bounded to stale_after param + timer logic + 2 tests, delegation complete, no open questions
<!-- overseer-gate: PASS 2026-06-28 -->
