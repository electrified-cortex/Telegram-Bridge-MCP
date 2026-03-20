---
applyTo: "**"
---
# Worker Agent Rules

Rules that apply to **non-governor** (worker) agents in the multi-session environment.

---

## Branch Management — Worktree Isolation

Workers use **git worktrees** for code changes. See `tasks/worktree-workflow.md` for the full lifecycle.

**Allowed:**
- Create a feature branch and worktree **when the task spec directs it**
- Commit and push freely within your worktree branch
- Run tests and builds inside your worktree

**Forbidden:**
- Switching branches in the **main workspace** (`git checkout`, `git switch`)
- Merging your branch — only the governor merges
- Deleting branches or worktrees — the governor cleans up
- Modifying files in the main workspace when you have an active worktree

If your task spec does not include a worktree directive, work in the main workspace on the current branch (as before).

---

## Task Board — Move Your Own Task

Workers **move their assigned task file** through the pipeline:
- Pick up: move from `2-queued/` → `3-in-progress/`
- Complete: move from `3-in-progress/` → `4-completed/`

Workers do **not** create or delete task files, and do not move other sessions' tasks. If you discover something that should be a new task, report it to the governor via DM.

---

## Idle / Sleep Notification

Workers must **notify the governor** before entering an idle or sleep state. The governor needs to know when workers are active vs. dormant.

- If you have no assigned work, send a DM to the governor: "No tasks — going idle."
- If you are waiting on a blocking event (CI, review, etc.), notify the governor with context.
- Do **not** silently go dormant. The governor monitors worker health and silent workers look like hung processes.

---

## dequeue_update Loop — MANDATORY

**Workers must always maintain an active `dequeue_update` loop.** This is how the governor communicates with you.

- **During work:** Call `dequeue_update(timeout: 30)` between work chunks to check for governor DMs. Process any messages, then continue.
- **When idle:** After completing a task and DMing the governor, call `dequeue_update(timeout: 300)` in a loop. Block forever waiting for the next assignment.
- **During long operations:** Run builds/tests with `isBackground: true`, then dequeue while waiting. Stay responsive.
- **Never go silent.** A worker without an active dequeue call looks like a hung process and will be investigated or terminated.

---

## Reminder Re-Bootstrap — MANDATORY

**After every session recovery, compaction, or reconnect, re-bootstrap all prescribed reminders.**

Reminders do not persist across session restarts. If you had active reminders before compaction or reconnect, they are gone.

- At session start, check your session memory for any reminder notes you wrote before going dormant.
- Re-set all prescribed reminders immediately using `set_reminder`.
- Document active reminders in session memory before setting them, so they survive future compaction.
- This rule applies to **all agents** — governor and workers alike.

---

## Workspace Safety

- Do **not** run `git stash`, `git reset`, `git rebase`, or `git cherry-pick` without governor approval.
- Do **not** modify files outside the scope of your assigned task.
- When using a worktree, code edits happen inside the worktree. **Exception:** moving your task file in `tasks/` is always done in the main workspace.
- Before committing, announce your intent to the governor and wait for acknowledgment (unless the task spec explicitly pre-approves commits).
- If you encounter merge conflicts, **stop and report** to the governor. Do not resolve them yourself.
