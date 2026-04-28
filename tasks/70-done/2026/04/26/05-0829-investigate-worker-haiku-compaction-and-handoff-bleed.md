---
id: 05-0829
title: investigate Worker haiku compaction + cross-Worker working-tree bleed
priority: 5
status: done
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

## Worker 1 debrief (confirms Hypothesis A)

Curator DM'd Worker 1 post-seal. Verbatim answers:

1. **Yes** — 24 files staged by Worker 2 when Worker 1 claimed. Not visible to Worker 1's first subagent because it ran `pnpm typecheck` against the index (saw staged fixes = 0 errors) and reported "nothing to do."
2. ~6 tool calls wasted on first dispatch (discovered nothing to fix), ~6 more for verification after Worker 1 checked `git diff --staged --stat` directly.
3. Fixes were pre-staged. Worker 1's subagent touched nothing.
4. Compaction within Worker 1: uncertain.
5. Worker 1 self-improvement: "Should have run `git diff --staged --stat` before dispatching any subagent on a pre-existing worktree. Would have revealed staged work in 1 tool call."

## Confirmed root cause

Worker 2's subagent finished editing 24 files and **staged** them, then Overseer's recovery rule fired because there were **no commits**. Recovery returned the task to 40-queued. Worker 1 claimed, eventually noticed the staged state, committed.

Two concrete bugs identified:

### Bug 1: Overseer recovery rule uses commits as the only progress signal

`git log dev..<branch>` returns empty even when significant edits are staged but uncommitted. Worker 2's subagent staged 24 files but didn't commit. Overseer saw "zero commits" → "no progress" → recovered. Misclassification.

**Fix:** Overseer's recovery decision must also check `git diff --staged --stat` and `git diff --stat` before recovering. Non-empty staged or unstaged tree = progress in flight, do not recover unilaterally.

### Bug 2: Worker pre-task inspection misses staged state

Worker 1 dispatched a subagent that ran typecheck and reported nothing to do, because the index was already clean (the fix was staged). 12 wasted tool calls.

**Fix:** Worker pre-task checklist must include `git diff --staged --stat` on a pre-existing worktree before dispatching any work. Saves ~6-12 tool calls per claim.

## Operator note (2026-04-26)

Before implementing: verify whether these patterns have already been addressed organically. If current Overseer recovery and Worker pre-task behavior already handles staged state, scope down to a quick audit + documentation only — do not add fixes that solve a problem that no longer exists.

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

## Completion

Completed 2026-04-26 by Worker 1.

**Verification result:** Both bugs were already addressed organically (per operator gate). Scope was audit + documentation + promoting fix from memory to skill.

**Bug 1 (Overseer recovery):** ALREADY FIXED in `overseer/context/refresh.md`. Rule now checks `git diff --stat --staged` alongside `git log`. No further action needed.

**Bug 2 (Worker staged-state inspection):** Fix was in auto-memory (`feedback_inspect_staged_before_dispatch.md`) but NOT in `task-execution/SKILL.md`. Promoted to canonical skill:
- Worker repo branch `05-0829` (commit `e04b8c5`): added staged-state check as step 3 in Worktree Gate. **Awaiting operator approval to merge.**

**Findings doc:** Curator repo branch `05-0829` (commit `2917415`): `notes/worker-recovery-postmortem-2026-04-25.md` — all 4 "What's NOT known" items resolved.

**Open items (not in scope):** Subagent telemetry, pre-recovery DM protocol, worktree inheritance notice — see postmortem recommendations.

Sealed-By: Overseer
