# 05-042: Agent & Doc Consistency Fixes

**Strategy: Direct**

Fix bugs and inconsistencies found during agent file audit and doc review.

## Issues

### 1. worker.agent.md — `interval_ms` Bug (HIGH)

The Animation Presets section uses `interval_ms` in `set_default_animation()` examples. That parameter does not exist on `set_default_animation` — it only accepts `frames`, `name`, and `reset`. The `interval` parameter exists on `show_animation` instead.

**Fix:** Remove `interval_ms` from all `set_default_animation` examples. If workers need a custom interval, they pass `interval` to `show_animation` calls, not `set_default_animation`.

### 2. overseer.agent.md — Post-Compaction Recovery Drain Order (MEDIUM)

Step 4 says: `notify` the operator → `dequeue_update` → re-enter loop.
This violates the "drain pending first" rule stated later in the same file's Telegram section.

**Fix:** Change step 4 to: `dequeue_update(timeout: 0)` to drain pending → then `notify` → then `dequeue_update` → re-enter loop.

### 3. worktree-workflow.md — Task File Rule Contradiction

The Rules section says: "Workers must not touch task files — the overseer manages the task board."
But the same file's procedures instruct workers to move task files. `worker-rules.instructions.md` also says workers move their own tasks.

**Fix:** Update: "Workers move their own assigned task file through the pipeline. They do not create, delete, or move other sessions' tasks."

### 4. worktree-workflow.md — Stale Branch Reference

Verification section references `v4-multi-session`. Current primary branch is `dev`.

**Fix:** Replace `v4-multi-session` with `dev`.

### 5. README.md — Stale Docker Tag

Docker section shows `4.1.0`. Current release is `4.3.0`.

**Fix:** Update to `4.3.0`.

## Acceptance

- All five issues resolved
- `pnpm lint` passes
