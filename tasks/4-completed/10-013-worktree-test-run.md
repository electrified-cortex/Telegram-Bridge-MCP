# Task 013 — Worktree Workflow Test Run

**Type:** Process validation
**Priority:** 10 (critical — blocks workflow adoption)

## Description

This is a **test task** to validate the new worktree workflow end-to-end. The goal is to prove the lifecycle works: create branch → create worktree → work in worktree → commit/push → report → governor verifies → governor merges → cleanup.

## The Work

Add a `## Worktree Support` section to `docs/design.md` at the end of the file with this content:

```markdown
## Worktree Support

Workers use git worktrees to isolate code changes from the main workspace. Each code-change task gets its own branch and worktree under `.git/.wt/`. The governor manages the merge and cleanup lifecycle. See `tasks/worktree-workflow.md` for the full process.
```

This is a real, small documentation change — not a throwaway.

## Worktree

Create worktree `10-013-worktree-test-run` from the current branch (`v4-multi-session`).
Branch: `task/013-worktree-test-run`

```bash
git branch task/013-worktree-test-run
git worktree add .git/.wt/10-013-worktree-test-run task/013-worktree-test-run
```

Then do all work inside `.git/.wt/10-013-worktree-test-run/`.

## Acceptance Criteria

- [ ] Worktree created at `.git/.wt/10-013-worktree-test-run`
- [ ] `docs/design.md` modified **only inside the worktree** (main workspace file unchanged)
- [ ] Commit made in the worktree branch
- [ ] Branch pushed to origin
- [ ] DM sent to governor confirming completion
- [ ] No files modified in the main workspace directory

## Notes

- You are **pre-approved to commit and push** within the worktree branch. No need to ask first.
- Do **not** move this task file. The governor handles task board management.
- Read `tasks/worktree-workflow.md` for the full workflow reference.
