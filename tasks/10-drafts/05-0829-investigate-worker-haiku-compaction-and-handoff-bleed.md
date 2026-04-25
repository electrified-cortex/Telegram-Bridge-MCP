---
id: 05-0829
title: investigate Worker haiku compaction + cross-Worker working-tree bleed
priority: 5
status: draft
type: investigation
delegation: any
---

# Investigate Worker haiku compaction + cross-Worker working-tree bleed

Two related concerns surfaced during today's `05-0828` cycle. Both are systemic and could repeat on any future task. Operator: "ultra high priority right now ... we've been burning through tokens a little too fast, probably because of these loops."

## Observation 1: false-positive recovery on Worker 2

Timeline:

- 10:21 — Worker 2 claims `05-0828`.
- 10:21–10:34 — Worker 2 runs (~13 min), apparently dispatches a subagent that runs ~5 vitest cycles, has zero commits, zero staging visible to Overseer's pulse check.
- 10:34 — Overseer triggers recovery (interpreted no commits + unresponsive pulse as stuck), returns task to 40-queued.
- 10:35 — Worker 1 claims `05-0828`.
- 10:39–10:41 — Worker 1 runs 2 vitest cycles, commits the fix at 10:41 (only ~6.5 min after claim).
- 10:42 — Sealed.

Total wall time 20 min, but Worker 1's 6.5 min for 99 fixes across 25 files is suspiciously fast unless Worker 1 inherited Worker 2's already-edited working tree.

## Hypothesis A: working-tree bleed across Workers

Workers share the same filesystem (no per-worker checkout isolation). When Overseer "recovered" the task by moving the file from 50-active to 40-queued, the actual code edits Worker 2's subagent had made to test files remained in the working tree. Worker 1 claimed, observed already-fixed tests, ran a verification cycle, committed.

If true: the recovery was a no-op functionally (the work landed) but it (a) wasted the intent of recovery, (b) means Worker 1 sealed work it didn't do, (c) creates an audit-trail gap (the fix commit is attributed to Worker 1 even though Worker 2 did most of the editing).

## Hypothesis B: haiku compaction loop within Worker

Operator's hypothesis: "Maybe it's a haiku compaction problem ... haiku's inability to work with existing context." If Worker's main agent (or its dispatched subagent) hits compaction mid-task, it loses track of what it has already done and re-attempts work. That would explain 5 vitest cycles in a 13-minute Worker 2 window — possibly retrying after losing context.

We have no telemetry on per-subagent token usage or compaction events. Cannot confirm or deny from outside.

## Hypothesis C: Worker 2's main agent was idle, subagent productive

The pulse checks failed because the main Worker 2 agent was blocked waiting for its dispatched subagent (single-threaded). Subagent was actually productive. Recovery was unnecessary. Worker 1 picked up the working-tree state and finished.

## What's actually known

- Work landed (`05-0828` sealed, 2762 tests pass, 99 errors fixed).
- 5 vitest output files in Worker 2's session dir, ~58KB each, ~2390 lines each, NOT byte-identical (different MD5s but same size — vitest verbose output of separate runs).
- Worker 1's session has 2 vitest output files of similar size during its claim window.
- Token cost of the cycle is high but not measured precisely.

## What's NOT known

- Whether Worker 1 actually re-edited any files or just inherited the working tree.
- Whether Worker 2's subagent hit compaction.
- Per-subagent tool call counts (Overseer's "198" came from Worker 2's self-report only).
- Whether the same scenario happened silently within Worker 1's run.

## Investigation steps (next session)

1. **Working-tree provenance check.** Inspect git's reflog or fs-event timestamps to determine whether the test files were modified during Worker 2's claim window or Worker 1's. If Worker 2's edits survived recovery, that's Hypothesis A confirmed.

2. **Add subagent telemetry.** Wrap Claude Code's subagent dispatch in a logger that records: subagent start, tool count, duration, exit reason, compaction events. Without this, we can't see inside subagent behavior.

3. **Per-Worker working-tree isolation.** Either give each Worker a separate worktree (current `.worktrees/<task>` pattern) AND scrub it on recovery, or accept that Workers share the tree and document the implications.

4. **Compaction-aware task planning.** If haiku subagents hit compaction frequently, the task spec should bound their work or provide explicit re-entry instructions. The Worker.agent.md "orchestrator-only" rule may need to specify upper bounds on subagent work units.

5. **Recovery preconditions.** Overseer's pulse-check + zero-commit recovery rule needs to factor in long-running subagents. Concretely: before recovering, DM Worker, ask if subagent in flight, only recover after acknowledged-no.

## Acceptance criteria

- Findings document at `agents/curator/notes/worker-recovery-postmortem-2026-04-25.md` (or similar) with answers to all 4 "What's NOT known" items.
- At least one durable change shipped from the findings: telemetry hook, Worker.agent.md update, recovery rule update, or worktree isolation policy.
- Operator approves the durable change before merge.

## Out of scope

- Rewriting the Worker→Subagent dispatch contract from scratch.
- Changing the haiku model class for Workers (operator has not signaled this).
- Adding tool-call hard limits without operator approval.

## Related

- `feedback_dont_supersede_overseer` — recovery is an Overseer call, but Overseer needs better signals.
- `feedback_dispatch_context_truth` — dispatched agents bootstrap fresh; only project CLAUDE.md + memory index transfer. Compaction behavior is separate.
- `feedback_dispatch_hook_bypass_risk` — git-diff every dispatch (here: confirm Worker 1's commit matches Worker 2's hypothesized edits).
- `15-0827` — seal commit gap (related: Worker→Worker file handoff isn't well-defined).
