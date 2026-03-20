# Task Board Hygiene

**Frequency:** Every 15 min | **Scope:** Overseer only

## Procedure

1. List `tasks/` subdirectories: `0-backlog`, `1-draft`, `2-queued`, `3-in-progress`, `4-completed`.
2. Check for misplaced files:
   - Completed tasks still in `0-backlog` or `3-in-progress`.
   - Duplicates across folders.
   - Stale drafts that should be promoted or removed.
3. Check `2-queued/` — workers pick up queued tasks autonomously via their own reminders. Only DM a worker directly for urgent re-prioritization.
4. Check `3-in-progress/` — if tasks have been active for a while, verify the assigned worker is making progress.
5. Fix trivial issues directly. Flag anything needing operator approval.

## Dynamic Follow-Up

If active or queued tasks are found, create a **one-shot 5-min reminder** to check progress.
