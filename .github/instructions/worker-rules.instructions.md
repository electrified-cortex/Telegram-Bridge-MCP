---
applyTo: "**"
---
# Worker Agent Rules

Rules that apply to **non-overseer** (worker) agents in the multi-session environment.

---

## Branch Management — Worktree Isolation

Workers use **git worktrees** for code changes. See `tasks/worktree-workflow.md` for the full lifecycle.

**Allowed:**
- Create a feature branch and worktree **when the task spec directs it**
- Commit and push freely within your worktree branch
- Run tests and builds inside your worktree

**Forbidden:**
- Switching branches in the **main workspace** (`git checkout`, `git switch`)
- Merging your branch — only the overseer merges
- Deleting branches or worktrees — the overseer cleans up
- Modifying files in the main workspace when you have an active worktree

If your task spec does not include a worktree directive, work in the main workspace on the current branch (as before).

---

## Task Board — Move Your Own Task

Workers **move their assigned task file** through the pipeline:
- Pick up: move from `2-queued/` → `3-in-progress/`
- Complete: move from `3-in-progress/` → `4-completed/`

Workers do **not** create or delete task files, and do not move other sessions' tasks. If you discover something that should be a new task, report it to the overseer via DM.

---

## Idle / Sleep Notification

Workers must **notify the overseer** before entering an idle or sleep state. The overseer needs to know when workers are active vs. dormant.

- If you have no assigned work, send a DM to the overseer: "No tasks — going idle."
- If you are waiting on a blocking event (CI, review, etc.), notify the overseer with context.
- Do **not** silently go dormant. The overseer monitors worker health and silent workers look like hung processes.

---

## dequeue_update Loop — MANDATORY

**Workers must always maintain an active `dequeue_update` loop.** This is how the overseer communicates with you.

- **During work:** Call `dequeue_update` between work chunks to check for overseer DMs. Uses the default 300 s wait — ensures you stay responsive without wasting tool calls. Process any messages, then continue.
- **When idle:** After completing a task and DMing the overseer, call `dequeue_update` in a loop. Block waiting for the next assignment.
- **During long operations:** Run builds/tests with `isBackground: true`, then dequeue while waiting. Stay responsive.
- **Never go silent.** A worker without an active dequeue call looks like a hung process and will be investigated or terminated.

---

## Reminder Re-Bootstrap — MANDATORY

**After every session recovery, compaction, or reconnect, re-bootstrap all prescribed reminders.**

Reminders do not persist across session restarts. If you had active reminders before compaction or reconnect, they are gone.

- At session start, check your session memory for any reminder notes you wrote before going dormant.
- Re-set all prescribed reminders immediately using `set_reminder`.
- Document active reminders in session memory before setting them, so they survive future compaction.
- This rule applies to **all agents** — overseer and workers alike.

---

## Friction Protocol

Friction means something is blocking you — stop and report. Pushing through friction creates
cascading problems: bad commits, corrupted task state, and cleanup work for everyone.

- **One retry max.** A second failure confirms the problem is real, not transient.
- **Never brute-force.** Retrying the same command wastes tokens and can cause side effects.
- **Missing files / unexpected state** — stop, DM the overseer with what you tried and what failed.
- **Report up immediately.** The overseer can unblock you faster than you can unblock yourself.

### Escalation Format

When you hit a blocker you can't resolve after one retry, DM the overseer:

```text
🚧 Blocked: <task name>
Tried: <what you attempted>
Failed: <what went wrong>
Needed: <specific unblock — decision, file, access, etc.>
```

Don't wait to be asked. Don't keep trying. Surface the problem immediately.

### Permission Denial

If a tool call is denied:

1. **Stop immediately.** Do not retry the denied action.
2. **DM the overseer** with the tool name, what you were trying to do, and that you are stopping.
3. **Do not work around the denial.** If the action was denied, it needs permission review — not
   an alternate tool that achieves the same blocked outcome.

---

## Workspace Safety

- Do **not** run `git stash`, `git reset`, `git rebase`, or `git cherry-pick` without overseer approval.
- Do **not** modify files outside the scope of your assigned task.
- When using a worktree, code edits happen inside the worktree. **Exception:** moving your task file in `tasks/` is always done in the main workspace.
- Before committing, announce your intent to the overseer and wait for acknowledgment (unless the task spec explicitly pre-approves commits).
- If you encounter merge conflicts, **stop and report** to the overseer. Do not resolve them yourself.
