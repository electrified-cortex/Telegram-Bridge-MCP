# Reminders

Procedure docs for recurring reminders. Each file describes what to check and how to act.

**Two patterns:**

1. **Direct** — The overseer executes the procedure itself. The reminder text is the action directive.
2. **Dispatch** — The overseer fires a specialist subagent via `runSubagent(agentName)`, reads the structured report, and acts on findings. Dispatch reminder files are marked with a blockquote at the top.

```powershell
set_reminder(text: "Run `git status --short`. Check branch, uncommitted changes, untracked files, remote divergence. → tasks/reminders/02-git-state-audit.md", delay: 600, recurring: true)
```

When a reminder fires, the overseer:

1. Reads the action directive (the text itself may be enough for direct reminders)
2. For **dispatch reminders**: calls `runSubagent(agentName: "<Agent Name>")`, reads the report, acts on `ACTION_NEEDED`
3. For **direct reminders**: reads the referenced file if needed, executes the procedure

## Overseer Startup Reminders

### Direct (overseer handles)

| # | File | Reminder Text | Delay | Recurring |
| --- | --- | --- | --- | --- |
| 1 | [01-task-board-hygiene.md](01-task-board-hygiene.md) | Scan `tasks/` folders for duplicates, misplaced files, stale drafts. Assign queued tasks to workers. Verify in-progress workers are active. → `tasks/reminders/01-task-board-hygiene.md` | 15 min | Yes |
| 2 | [02-git-state-audit.md](02-git-state-audit.md) | Run `git status --short`. Check branch, uncommitted changes, untracked files, remote divergence. Investigate anything unexpected. → `tasks/reminders/02-git-state-audit.md` | 10 min | Yes |
| 7 | [07-operator-check-in.md](07-operator-check-in.md) | If no operator contact in 10 min, send brief `notify` with current status (1–2 sentences). Don't escalate if unresponsive. → `tasks/reminders/07-operator-check-in.md` | 10 min | Yes |
| 10 | [10-worker-health.md](10-worker-health.md) | Check active worker sessions (`list_sessions`). Ping any worker silent >10 min. Investigate or reassign if unresponsive. → `tasks/reminders/10-worker-health.md` | 10 min | Yes |
| 11 | [11-server-build-drift.md](11-server-build-drift.md) | Compare `get_me().mcp_commit` with `dist/tools/build-info.json`. Prompt restart on drift. → `tasks/reminders/11-server-build-drift.md` | 20 min | Yes |

### Dispatch (fire subagent via `runSubagent`)

These reminders dispatch a specialist agent — no procedure file needed. The agent file in `.github/agents/` contains the full procedure.

| # | Agent Name | Delay | Recurring |
| --- | --- | --- | --- |
| 3 | Task Build Lint | 20 min | Yes |
| 4 | Task Test Suite | 30 min | Yes |
| 5 | Task Changelog Audit | 60 min | Yes |
| 6 | Task Doc Hygiene | 60 min | Yes |
| 8 | Task PR Review | 15 min | Yes |
| 9 | Task PR Health | 30 min | Yes |

## Worker Startup Reminders

| # | Reminder Text | Delay | Recurring |
| --- | --- | --- | --- |
| 1 | Check `tasks/2-queued/` for unassigned tasks — pick up and DM overseer | 5 min | Yes |
| 2 | DM overseer with current status (working/idle/blocked) | 5 min | Yes |

## Dynamic Reminders

Reminders can spawn reminders:

- When the task board check finds queued/active tasks, create a **one-shot 5-min** follow-up to check progress.

- "Check back on task X" after assigning work.

## Adding New Reminders

1. Create a new numbered `.md` file in this folder (e.g., `10-new-check.md`).
2. Add it to the overseer table above.
3. The reminder text is the lookup key — keep it distinctive.
