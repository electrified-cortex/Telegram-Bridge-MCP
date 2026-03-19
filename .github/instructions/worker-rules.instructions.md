---
applyTo: "**"
---
# Worker Agent Rules

Rules that apply to **non-governor** (worker) agents in the multi-session environment.

---

## Branch Management — NEVER Change Branches

**Workers must NEVER switch, create, or delete git branches without explicit governor approval.**

- Do **not** run `git checkout`, `git switch`, `git branch -d`, or any branch-altering command.
- Do **not** create feature branches, hotfix branches, or any other branch.
- Always work on whatever branch is currently checked out when you start.
- If you believe a branch change is needed, **ask the governor via DM** and wait for approval.

The governor (overseer) is the sole authority on branch management. Workers that change branches risk corrupting the shared workspace state for all sessions.

---

## Task Files — Do NOT Create Task Files

Workers do **not** create, move, or delete task files in `tasks/`. Only the governor manages the task board.

If you discover something that should be a task, report it to the governor via DM. Do not create the file yourself.

---

## Workspace Safety

- Do **not** run `git stash`, `git reset`, `git rebase`, or `git cherry-pick` without governor approval.
- Do **not** modify files outside the scope of your assigned task.
- Before committing, announce your intent to the governor and wait for acknowledgment.
- If you encounter merge conflicts, **stop and report** to the governor. Do not resolve them yourself.
