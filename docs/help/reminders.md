Reminder-Driven Follow-Up — Primary async tracking tool for delegation and async ops.

Every delegation or async dispatch should have a corresponding reminder.

## Core Pattern
1. Create reminder FIRST (before dispatch).
2. Dispatch work (DM, task, subagent).
3. On reminder fire → check status.
   - Done → cancel reminder.
   - Not done → follow up with agent.
4. On agent confirmation → cancel reminder.

## Why Reminder First
Guarantees follow-up exists even if:
- Dispatch fails silently.
- Context compaction drops delegation from memory.
- Session restarts before confirmation arrives.

## API
action(type: "reminder/set", text: "Verify Deputy completed [task]", delay_seconds: 600)
action(type: "reminder/set", text: "Check Worker [task]", delay_seconds: 1800, recurring: true)
action(type: "reminder/cancel", id: "<reminder_id>")
action(type: "reminder/list")

## Timing Reference
| Delegate              | Delay     | Rationale                     |
| Deputy                | 10 min    | Fast turnaround, local context |
| Worker (small task)   | 15–30 min | Claim + execute                |
| Worker (large task)   | 60 min    | Multi-file changes, builds     |
| Overseer              | 30 min    | Pipeline coordination          |

Adjust based on complexity. Use recurring: true for long-running work.

## Who Benefits Most
- Curator — primary beneficiary. Delegates constantly, must verify everything.
- Overseer — Worker management.
- Any agent waiting on builds, external processes, or operator input.

Full reference: skills/reminder-driven-followup/SKILL.md
