# 10-0891 — Remind agents to arm Monitor when activity-file is created

## Priority

10 (normal — UX gap, not blocking)

## Context

Currently `action(type: "activity/file/create")` provisions an activity
file at `<bridge>/data/activity/<id>` and returns the path. The
agent is expected to know it should arm a Monitor tool against that
path so file changes trigger dequeues. In practice agents (this
Curator session 2026-05-09) skip the Monitor arming step because:

- The response doesn't hint at the next action.
- No service message follows up on the next dequeue to remind.
- Long-poll dequeue is sufficient for round-trip work, so the
  Monitor feels optional — until the operator notices the gap.

The bridge has no way to know whether the caller actually armed a
watcher, but it can nudge.

## What's wanted

Two-prong reminder so the agent doesn't drop the watcher step:

1. **`activity/file/create` response includes a hint** — for example
   add a `next_action` or `hint` field reading something like
   `"Arm a Monitor tool watching <file_path>. Call dequeue() to receive
   the full setup reminder."`

2. **Service message on next dequeue** — the bridge tracks that an
   activity file was created for this session and not yet acked.
   On the next dequeue (until acked), prepend a service message:
   ```
   {
     "type": "service",
     "event_type": "activity_file_monitor_reminder",
     "text": "Activity file created at <path>. Arm a Monitor tool
              against it so file changes trigger dequeue. ..."
   }
   ```

   Ack mechanism: when the bridge sees the agent has dequeued at
   least once after creation, mark reminder-served and stop emitting.

## Acceptance criteria

- `activity/file/create` response includes a `hint` (or equivalent
  field) pointing at Monitor arming.
- Bridge tracks per-session activity-file-created state.
- Next dequeue after create emits a `service_message` with
  `event_type: activity_file_monitor_reminder` exactly once.
- Subsequent dequeues do not re-emit.
- If a session creates multiple activity files (uncommon), each
  triggers its own one-time reminder.

## Notes

- Filed 2026-05-09 from Curator session that omitted the Monitor
  arm and operator caught the gap on review.
- The bridge already has the `service_message` plumbing; this is
  another event type plus tracking, not new infrastructure.
