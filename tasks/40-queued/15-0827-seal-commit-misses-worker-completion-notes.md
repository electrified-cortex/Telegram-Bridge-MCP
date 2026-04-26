---
id: 15-0827
title: seal commit misses Worker-added Completion notes on task files
priority: 15
status: draft
type: pipeline-bug
delegation: any
---

# Seal commit misses Worker completion notes

When a Worker adds a `## Completion` section to the task file after the fix is merged but before the seal step, the seal commit moves the file from `60-review/` to `70-done/<date>/` but does NOT include the Completion section addition. The notes sit as an unstaged modification in the working tree until someone notices.

## Reproduction (today's session, 15-0824)

1. Worker fixed `15-0824-react-emoji-fallback-with-hint.md`, ran tests (2758 pass), pushed branch.
2. Overseer squash-merged to dev, pushed.
3. Seal step moved task file from `tasks/60-review/15-0824-...md` to `tasks/70-done/2026/04/25/15-0824-...md`.
4. Worker (or Overseer) edited the moved file to add `## Completion` section with branch/commit/changes summary.
5. The seal commit `e243183d` did NOT include the Completion section content — it only contained the file rename.
6. Curator discovered the unstaged modification when attempting to merge dev → release/7.2; had to commit it as a follow-up before the merge could proceed.

## Why it matters

- The seal commit becomes incomplete history. Reviewers landing on `70-done/.../<task>.md` later miss the Completion notes if they look at the seal commit alone.
- The unstaged change blocks branch operations (checkout fails until commit/stash). For multi-branch work (release branches, hotfixes), this surfaces as friction at unpredictable moments.
- It is unclear which agent (Worker or Overseer) is supposed to add Completion notes and when.

## Proposed fixes (pick one)

### Option A — Workers add Completion before review

Worker writes Completion section as part of the fix work, BEFORE moving the task file to `60-review/`. Seal then naturally includes it because the file was already populated when the seal commit ran.

Pro: simplest, no script changes.
Con: requires updating Worker checklist/skills.

### Option B — Seal script auto-stages task changes

Overseer's seal script does `git add tasks/<task-file>` before committing the rename. Catches both Worker-added and Overseer-added Completion notes regardless of timing.

Pro: defensive, handles either timing.
Con: silently stages whatever's there, may surface unintended changes.

### Option C — Pre-seal hook: fail if task file has unstaged changes

Pre-seal check: `git diff --quiet -- tasks/<task-file>`. If non-empty, error with "stage task file changes before sealing."

Pro: forces explicit handling, no silent commits.
Con: adds friction; another step to remember.

## Recommendation

Option A is cleanest. Update Worker lifecycle: add "write Completion section" to the post-fix-pre-review checklist. Then no script changes needed and the seal commit captures the full record.

If Worker checklist update is too disruptive, Option B is acceptable because the only thing the seal script would auto-stage is the task file itself (scoped path), not arbitrary working-tree state.

## Acceptance criteria

- After implementing the chosen option, complete a fix-pipeline cycle end-to-end on a synthetic task and verify the seal commit contains the Completion section without any follow-up commit.
- Document the chosen flow in the Worker (and Overseer if Option B) skill or playbook.

## Related

- Today's evidence: `15-0824` task file was modified post-seal without a follow-up commit until Curator cleaned up at `66395c6`.
- Sealing pipeline: `tools/spawn-overseer.ps1`, Overseer's seal script (path TBD by implementer).
