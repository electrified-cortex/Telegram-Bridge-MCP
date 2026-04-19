---
name: reminder-driven-followup
description: >-
  Reminder-first delegation and follow-up pattern. Use when delegating work
  to any agent (Deputy, Overseer, Worker) or tracking any async operation
  that needs verification. Ensures nothing falls through the cracks.
compatibility: "Requires Telegram MCP bridge v6+"
---

# Reminder-Driven Follow-Up

Reminders are the primary async follow-up tool for Telegram session agents.
Every delegation or async dispatch should have a corresponding reminder.

## Core Pattern

```text
1. Create verification reminder (FIRST)
2. Dispatch work (DM, task, subagent)
3. On reminder fire → check status
   - Done → cancel reminder (or ignore if one-off)
   - Not done → follow up with agent
4. On agent confirmation → cancel the reminder
```

## Why Reminder First

Creating the reminder before dispatching guarantees follow-up exists even if:

- The dispatch fails silently
- Context compaction drops the delegation from memory
- The session restarts before confirmation arrives

## Reminder Timing

| Delegate | Suggested delay | Rationale |
| --- | --- | --- |
| Deputy | 10 min | Fast turnaround, local context |
| Worker (small task) | 15–30 min | Needs to claim + execute |
| Worker (large task) | 60 min | Multi-file changes, builds |
| Overseer | 30 min | Pipeline coordination |

Adjust based on task complexity. Recurring reminders for long-running work.

## API Reference

```text
# Set a one-off verification reminder
action(type: "reminder/set", text: "Verify Deputy completed [task]", delay_seconds: 600)

# Set a recurring check
action(type: "reminder/set", text: "Check Worker progress on [task]", delay_seconds: 1800, recurring: true)

# Cancel when confirmed
action(type: "reminder/cancel", id: "<reminder_id>")

# List active reminders
action(type: "reminder/list")
```

## Integration with Delegation

### Deputy Dispatch

```text
1. action(type: "reminder/set", text: "Verify Deputy completed skill audit", delay_seconds: 600)
2. send(type: "dm", target_sid: <deputy_sid>, text: "Run skill audit on X. Report findings.")
3. [reminder fires] → check Deputy's DM response
4. [Deputy confirms] → action(type: "reminder/cancel", id: "<id>")
```

### Task + Overseer

```text
1. action(type: "reminder/set", text: "Verify task 10-500 picked up by Worker", delay_seconds: 1800)
2. send(type: "dm", target_sid: <overseer_sid>, text: "New task 10-500 queued, priority 10.")
3. [reminder fires] → check task stage (still in 2-queued? → nudge)
4. [task moves to 3-in-progress] → cancel or set new reminder for completion
```

## Who Benefits Most

- **Curator** — primary beneficiary. Delegates constantly, must verify everything.
- **Overseer** — Worker management. Set reminders when dispatching tasks.
- **Any agent** — waiting on external processes, builds, or operator input.
