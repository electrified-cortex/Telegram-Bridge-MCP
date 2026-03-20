# Reminders

Procedure docs for recurring reminders. Each file describes what to check and how to act.

**Pattern:** The reminder text is an action directive — a short command telling the agent what to do. The file contains the detailed procedure for when more context is needed.

```
set_reminder(text: "Run `git status --short`. Check branch, uncommitted changes, untracked files, remote divergence. → tasks/reminders/02-git-state-audit.md", delay: 600, recurring: true)
```

When the reminder fires, the agent:
1. Reads the action directive (the text itself may be enough)
2. If more detail is needed, reads the referenced file
3. Executes the procedure

## Governor Startup Reminders

| # | File | Reminder Text | Delay | Recurring |
|---|------|--------------|-------|-----------|
| 1 | [01-task-board-hygiene.md](01-task-board-hygiene.md) | Scan `tasks/` folders for duplicates, misplaced files, stale drafts. Assign queued tasks to workers. Verify in-progress workers are active. → `tasks/reminders/01-task-board-hygiene.md` | 15 min | Yes |
| 2 | [02-git-state-audit.md](02-git-state-audit.md) | Run `git status --short`. Check branch, uncommitted changes, untracked files, remote divergence. Investigate anything unexpected. → `tasks/reminders/02-git-state-audit.md` | 10 min | Yes |
| 3 | [03-build-lint-health.md](03-build-lint-health.md) | Run `pnpm build && pnpm lint`. Notify operator immediately on failure. → `tasks/reminders/03-build-lint-health.md` | 20 min | Yes |
| 4 | [04-test-suite-health.md](04-test-suite-health.md) | Run `pnpm test`. Identify failures, track test count for regressions. Notify operator on failure. → `tasks/reminders/04-test-suite-health.md` | 30 min | Yes |
| 5 | [05-changelog-review.md](05-changelog-review.md) | Read `changelog/unreleased.md`. Check recent commits for missing entries. Flag behavior changes without changelog lines. → `tasks/reminders/05-changelog-review.md` | 60 min | Yes |
| 6 | [06-doc-hygiene.md](06-doc-hygiene.md) | Spot-check 1–2 docs for broken links, stale content, formatting. Fix trivial issues; task larger ones. → `tasks/reminders/06-doc-hygiene.md` | 60 min | Yes |
| 7 | [07-operator-check-in.md](07-operator-check-in.md) | If no operator contact in 10 min, send brief `notify` with current status (1–2 sentences). Don't escalate if unresponsive. → `tasks/reminders/07-operator-check-in.md` | 10 min | Yes |
| 8 | [08-pr-review-exhaustion.md](08-pr-review-exhaustion.md) | List open PRs. Read unresolved review comments. Address or flag each. Continue until all threads resolved. → `tasks/reminders/08-pr-review-exhaustion.md` | 10 min | Yes |
| 9 | [09-pr-health-check.md](09-pr-health-check.md) | List open PRs. Check new comments, CI status, Dependabot PRs. Notify operator of items needing attention. → `tasks/reminders/09-pr-health-check.md` | 30 min | Yes |
| 10 | [10-worker-health.md](10-worker-health.md) | Check active worker sessions (`list_sessions`). Ping any worker silent >10 min. Investigate or reassign if unresponsive. → `tasks/reminders/10-worker-health.md` | 10 min | Yes |

## Worker Startup Reminders

| # | Reminder Text | Delay | Recurring |
|---|--------------|-------|-----------|
| 1 | Check `tasks/2-queued/` for unassigned tasks — pick up and DM governor | 5 min | Yes |
| 2 | DM governor with current status (working/idle/blocked) | 5 min | Yes |

## Dynamic Reminders

Reminders can spawn reminders:
- When the task board check finds queued/active tasks, create a **one-shot 5-min** follow-up to check progress.
- "Check back on task X" after assigning work.

## Adding New Reminders

1. Create a new numbered `.md` file in this folder (e.g., `10-new-check.md`).
2. Add it to the governor table above.
3. The reminder text is the lookup key — keep it distinctive.
