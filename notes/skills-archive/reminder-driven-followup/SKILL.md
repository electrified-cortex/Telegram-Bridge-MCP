---
name: reminder-driven-followup
description: >-
  Reminder-first delegation and follow-up pattern. Use when delegating work
  to any agent or tracking any async operation that needs verification.
  Ensures nothing falls through the cracks.
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
| Lightweight sub-agent | 10 min | Fast turnaround, limited scope |
| Subordinate agent (small task) | 15–30 min | Needs to claim + execute |
| Subordinate agent (large task) | 60 min | Multi-file changes, builds |
| Supervising agent | 30 min | Pipeline coordination |

Adjust based on task complexity. Recurring reminders for long-running work.

## API Reference

```text
# Set a one-off verification reminder
action(type: "reminder/set", text: "Verify subordinate completed [task]", delay_seconds: 600)

# Set a recurring check
action(type: "reminder/set", text: "Check agent progress on [task]", delay_seconds: 1800, recurring: true)

# Cancel when confirmed
action(type: "reminder/cancel", id: "<reminder_id>")

# List active reminders
action(type: "reminder/list")
```

## Integration with Delegation

### Sub-Agent Dispatch

```text
1. action(type: "reminder/set", text: "Verify subordinate completed skill audit", delay_seconds: 600)
2. send(type: "dm", target_sid: <agent_sid>, text: "Run skill audit on X. Report findings.")
3. [reminder fires] → check subordinate's DM response
4. [subordinate confirms] → action(type: "reminder/cancel", id: "<id>")
```

### Task + Supervising Agent

```text
1. action(type: "reminder/set", text: "Verify task 10-500 picked up by subordinate agent", delay_seconds: 1800)
2. send(type: "dm", target_sid: <supervisor_sid>, text: "New task 10-500 queued, priority 10.")
3. [reminder fires] → check task stage (still in 2-queued? → nudge)
4. [task moves to 3-in-progress] → cancel or set new reminder for completion
```

## Who Benefits Most

- **Governor session** — primary beneficiary. Delegates constantly, must verify everything.
- **Supervising agent** — subordinate agent management. Set reminders when dispatching tasks.
- **Any agent** — waiting on external processes, builds, or operator input.
