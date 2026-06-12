# Task #026 — Wire Reminders to Prompts

## Objective

Replace the governance idle loop and periodic behavior rules in agent prompts with a single directive: "Set up all reminders from `reminders/README.md` at session start." The reminders system becomes the single source of truth for all periodic governance.

## Problem

Currently, governance behaviors are duplicated:
- `copilot-instructions.md` has a "Governor Idle Loop" section (8 items, ~30 lines) that describes periodic checks
- `reminders/` has 9 procedure files covering the same checks
- Both are loaded into context — the prompt rules permanently, reminders on-demand when they fire

This duplication wastes tokens and creates drift risk.

## Design

### 1. Make reminder text self-contained

Each reminder's text should be an actionable directive — the agent can execute it without reading the linked file. The file becomes reference for edge cases only.

**Before:**
```
Scan task board for misplaced or stale items → reminders/01-task-board-hygiene.md
```

**After:**
```
List all tasks/ folders. Flag duplicates or misplaced files. Assign queued tasks to available workers. Verify in-progress workers are active. Details: reminders/01-task-board-hygiene.md
```

### 2. Strip governance idle loop from prompts

Remove the "Governor Idle Loop" section from `copilot-instructions.md`. Replace with:

```markdown
## Startup Reminders

On session start, read `reminders/README.md` and call `set_reminder` for every entry in the applicable table (Overseer or Worker). Reminder text is the action directive — execute it when it fires.
```

### 3. Audit coverage

Ensure every item in the current idle loop maps to a reminder file:

| Idle Loop Item | Reminder File | Status |
|---|---|---|
| Operator check-in | `07-operator-check-in.md` | ✅ Covered |
| Worker health | — | ❌ Missing reminder |
| Task board hygiene | `01-task-board-hygiene.md` | ✅ Covered |
| Git state audit | `02-git-state-audit.md` | ✅ Covered |
| Build/lint health | `03-build-lint-health.md` | ✅ Covered |
| Test health | `04-test-suite-health.md` | ✅ Covered |
| Doc hygiene | `06-doc-hygiene.md` | ✅ Covered |
| Changelog review | `05-changelog-review.md` | ✅ Covered |
| GitHub issues & PRs | `09-pr-health-check.md` | ✅ Covered |

### 4. Create missing reminder: Worker Health

Add `10-worker-health.md`:
- **Frequency:** Every 10 min | Governor only
- Check if worker sessions are active. Ping idle workers. If a worker has been silent >10 min, investigate.

### 5. Enrich reminder text in README table

Update each reminder's text column with a self-contained action directive. Keep the file reference as a suffix.

## Scope

- `reminders/` → `tasks/reminders/` — move entire folder under tasks/ to group all governance artifacts together
- `tasks/reminders/README.md` — update text column for all 9 entries, add worker health entry
- `tasks/reminders/10-worker-health.md` — new file
- `.github/copilot-instructions.md` — strip "Governor Idle Loop" section, add "Startup Reminders" directive, update reminders path references
- `tasks/OVERSEER-PROMPT.md` — update if it references idle loop or reminders path
- `tasks/WORKER-PROMPT.md` — update if it references idle loop or reminders path
- Update any other files referencing `reminders/` path to `tasks/reminders/`

## Notes

- No code changes — docs/config only
- No worktree needed, work directly on a branch from master
- This is a relatively low-risk refactor since it's all documentation
