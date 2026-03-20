# Task Workflow

How the overseer assigns work and how workers execute it.

## Assignment Modes

The overseer picks one per task and specifies it in the task spec:

| Mode | When to use | Task spec includes |
| --- | --- | --- |
| **Direct edit** | Single-file docs, configs, task board changes | No `## Worktree` section |
| **Worktree** | Code changes, multi-file features, anything that could break the build | `## Worktree` section with branch + directory |

The merge strategy (direct merge vs PR) is the **overseer's call**. Workers push; the overseer merges.

---

## Worker: Direct Edit Tasks

No `## Worktree` section in the task spec:

1. Move task file: `2-queued/` → `3-in-progress/`
2. Edit files in the main workspace
3. DM overseer with commit message, wait for approval
4. Commit and push
5. Move task file: `3-in-progress/` → `4-completed/`
6. DM overseer: done

## Worker: Worktree Tasks

Task spec has a `## Worktree` section:

### 1. Claim

Move task file: `2-queued/` → `3-in-progress/`. Do this **before** reading the spec.

### 2. Create branch + worktree

```bash
git branch task/018-feature-name
git worktree add .git/.wt/20-018-feature-name task/018-feature-name
```

Worktrees live under `.git/.wt/` — keeps the workspace root clean.

### 3. Work inside the worktree

All code edits happen in the worktree. The only main workspace change is task file movement.

```bash
cd .git/.wt/20-018-feature-name
# edit, test, iterate
```

Use sub-agents for scoped subtasks (searching, writing tests, boilerplate).

### 4. Commit and push

DM overseer with commit message. After approval:

```bash
git add -A
git commit -m "feat: description (#018)"
git push -u origin task/018-feature-name
```

### 5. Complete

1. Move task file: `3-in-progress/` → `4-completed/` (in main workspace)
2. DM overseer: *"Task #018 complete. Branch `task/018-feature-name`. Tests passing."*

**Stop here.** Do not merge, delete branches, or remove worktrees.

---

## Overseer: Task Assignment

| Task type | Worktree? |
| --- | --- |
| Source code (features, fixes, refactors) | **Yes** |
| Multi-file doc overhauls | Overseer's discretion |
| Single-file edits (README, changelog, config) | **No** |
| Task board changes | **No** |

Include in the task spec for worktree tasks:

```markdown
## Worktree

Branch: `task/018-feature-name`
Directory: `.git/.wt/20-018-feature-name`
Base: `master` at current HEAD
```

### Merge Strategy

After a worker reports completion, the overseer picks one:

**Direct merge** — low-risk changes (docs, small fixes, config):
```bash
git merge --no-ff task/013-worktree-test-run
```

**PR-based merge** — features, runtime changes, anything needing review:
```bash
# Create PR from task/013-worktree-test-run → dev branch
# CI runs, Copilot reviews, operator approves
```

Use PR-based merge when:
- The change modifies source code (`src/`)
- The feature is large or complex
- You want CI validation before merging
- The operator wants a review checkpoint

### Verification

Before merging (either strategy):

```bash
cd .git/.wt/10-013-worktree-test-run
pnpm test
pnpm lint
git log --oneline -5
git diff v4-multi-session..task/013-worktree-test-run --stat
```

### Cleanup

After the branch is merged:

```bash
git worktree remove .git/.wt/10-013-worktree-test-run
git push origin --delete task/013-worktree-test-run
```

Local branch deletion (`git branch -d`) may be policy-blocked in automated sessions. Stale local branches are harmless — the operator can clean them up periodically.

### Review & Archival

The overseer reviews tasks that arrive in `4-completed/`:

**If successful:**
- Merge the branch (direct or PR), clean up worktree/branch
- Move the task file into a dated subfolder: `4-completed/YYYY-MM-DD/`
- This signals the work is reviewed and accepted

**If unsuccessful:**
- Add a note to the task file explaining what wasn't done or wasn't right
- Move the task back to `2-queued/` (needs another pass) or `1-drafts/` (needs rethinking)

## Rules

- Workers **must not** modify files in the main workspace when operating in a worktree.
- Workers **can** create branches and worktrees when directed by the task spec.
- Workers **can** commit and push freely within their worktree branch.
- Workers **must not** merge their branch — the overseer does that.
- Workers **must not** touch task files — the overseer manages the task board.
- If tests fail in the worktree, report the failure to the overseer. Do not merge broken code.
