Reminder — Async follow-up and delegation tracking.

Routes:
- reminder/set — create reminder (time or startup trigger)
- reminder/cancel — cancel reminder by ID
- reminder/list — list all active reminders

action(type: "reminder") — lists sub-paths in live API.

Full guide: help(topic: 'reminders') — covers delegation patterns, timing tables, and core workflow.

## Quick pattern
Set before dispatching work → reminder fires if no confirmation arrives → follow up or cancel.

Related: profile/save, profile/load, dequeue
