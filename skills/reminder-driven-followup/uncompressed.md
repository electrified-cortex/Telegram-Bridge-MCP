# reminder-driven-followup — uncompressed

## What this skill governs

The reminder-first pattern that prevents async delegated work from falling through the cracks. Every async dispatch — DM to a peer session, task assignment, long-running sub-agent invocation — gets a verification reminder created BEFORE the dispatch fires.

This skill does NOT cover:
- Synchronous tool calls (result is immediate — no reminder needed).
- Main loop liveness (reminders are not a substitute for the dequeue loop).
- Cron-style bridge-managed schedules.

## Why reminder first

Creating the reminder BEFORE dispatching guarantees follow-up coverage even if:
- The dispatch fails silently (the reminder still fires).
- Context compaction drops the delegation record from in-memory history.
- The session restarts before confirmation arrives.

Creating the reminder AFTER dispatch leaves a window where the work is untracked. Never dispatch first.

## Core pattern (5 steps)

```text
1. Create verification reminder (BEFORE dispatch).
2. Dispatch the work (DM, task queue, sub-agent).
3. Reminder fires -> check dispatchee status.
   - Done? -> cancel reminder.
   - Not done? -> follow up with dispatchee, optionally re-arm.
4. Dispatchee sends confirmation -> cancel reminder (if not already cancelled).
5. (No step 5 — reminder cycle ends here.)
```

## API calls

```text
# One-shot reminder (use when dispatchee expected to complete quickly)
action(type: "reminder/set", text: "Verify <work description>", delay_seconds: 600)

# Recurring reminder (use for long-running work needing repeated checks)
action(type: "reminder/set", text: "Check <work description>", delay_seconds: 1800, recurring: true)

# Cancel when confirmed
action(type: "reminder/cancel", id: "<reminder_id>")

# Disable (pauses without deleting)
action(type: "reminder/disable", id: "<reminder_id>")

# Postpone
action(type: "reminder/sleep", id: "<reminder_id>", delay_seconds: 900)
```

Full reference: `help('action')` for the canonical reminder lifecycle.

## One-shot vs recurring

Use a one-shot reminder when: the expected completion window is short and well-defined.
Use a recurring reminder when: the work may take multiple check cycles, or the dispatchee's cadence is unknown.

When re-arming via recurring, use `dedup_id` to prevent the reminder from stacking:
```text
action(type: "reminder/set", ..., recurring: true, dedup_id: "verify-<work-id>")
```

Re-arming with the same `dedup_id` replaces the existing reminder instead of creating a duplicate.

## Text convention

Reminder text should name the verification target clearly: "Verify <dispatchee> completed <work>". Keep it short enough to orient you when the reminder fires after a context gap. Do not use fleet-specific labels in the text — generic dispatching-agent / dispatched-agent framing is sufficient.

## Don'ts

- Do not use reminders as a substitute for dequeue-loop responsiveness. Reminders cover async delegation; the main loop covers liveness.
- Do not introduce fire-and-forget exceptions. Every async dispatch gets a reminder.
- Do not bake specific timing into this skill — interval depends on context and dispatchee characteristics, not a fixed policy.
