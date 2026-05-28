---
id: 15-0807
title: Task batch-promotion should check for pre-existing completed branches
status: idea
priority: 15
origin: Worker 6 discovery 2026-04-24 — commit 2d89ac0
marker: needs refinement
---

# Task batch-promotion should check for pre-existing completed branches

## Observation

Commit `2d89ac0 tasks: promote 24 TMCP drafts to 40-queued` (2026-04-24) re-promoted tasks whose branches were already complete to `40-queued`. Three tasks caught in the cross-fire:

- `10-413` — Worker 1 branch complete, in 60-review on branch
- `10-432` — Worker 1 branch complete, in 60-review on branch
- `10-725` — Worker 1 branch complete, in 60-review on branch

Effect: Worker 6 claimed `10-413` from the (wrongly-re-queued) draft, then discovered the existing completion on branch. Wasted claim cycle; confusion about whether to re-implement.

## Proposed behavior

Whatever script/skill/agent is doing the batch promotion to `40-queued` should, before promoting each task:

1. Check whether a branch named `<task-id>` exists.
2. If yes: check whether the branch's task file at `tasks/60-review/<task-id>-*.md` (or `tasks/50-active/`) exists.
3. If the branch is complete (task file in 60-review on branch, task doc has `## Completion` section): skip the promotion, OR promote to `60-review` on main/dev directly with a note that the branch is pending merge.

## Open questions

- What script/skill performed the batch promotion? Grep commit `2d89ac0`'s author + context to identify.
- Was the promotion Overseer-driven, Curator-driven, or operator-driven? Different fixes depending.
- Is this a one-off error or a systemic gap in the promotion logic?

## Acceptance criteria

- Promotion logic (whoever/whatever runs it) has a pre-check for pre-existing completed branches.
- Re-queue of already-completed tasks is prevented or cleanly routed to 60-review.

## Don'ts

- Don't retroactively "fix" the three caught tasks by force-moving their files. The branches will land via the normal merge path and the moves will resolve.
