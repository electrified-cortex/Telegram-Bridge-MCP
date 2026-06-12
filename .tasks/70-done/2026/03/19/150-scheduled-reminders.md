# Task 150 — Scheduled Reminders (Idle-Queue Triggers)

## Summary

Allow agents to register **reminders** that fire when the message queue is idle. When `dequeue_update` times out with no operator/worker messages, any due reminders surface as synthetic events — enabling agents to self-prompt, check on processes, or nudge the operator.

## Motivation

Agents currently rely on manual discipline (idle loop checklists) to remember follow-ups. A built-in reminder system makes this automatic and reliable:
- "Remind me to check CI in 5 minutes"
- "After 1 minute of idle, ask the operator if they reviewed the PR"
- Recurring reminders: "Every 10 minutes, check worker health"

## Design

### New MCP Tool: `set_reminder`

```ts
{
  name: "set_reminder",
  inputSchema: {
    text: z.string().max(500),        // Reminder message
    delay_seconds: z.number().min(0).max(86400).optional(), // When to become active (default: 0 = immediately active)
    recurring: z.boolean().optional(), // Re-arm after firing? (default: false)
    id: z.string().optional(),         // Optional ID for cancellation (auto-generated if omitted)
  }
}
```

### New MCP Tool: `cancel_reminder`

```ts
{
  name: "cancel_reminder",
  inputSchema: {
    id: z.string(),  // Reminder ID to cancel
  }
}
```

### New MCP Tool: `list_reminders`

```ts
{
  name: "list_reminders",
  // No input — returns all reminders (deferred + active) for the calling session
}
```

### Two-Tier Queue System

Reminders have two states:

1. **Deferred** — has a `delay_seconds` > 0. The delay is the *minimum* time before the reminder can fire — it won't fire any earlier, but may fire later depending on when the next idle window occurs. After `created_at + delay_seconds` has passed, the reminder auto-promotes to the **active** queue.
2. **Active** — ready to fire. Gets delivered to the agent only after 60 seconds of idle (no real messages) within a `dequeue_update` call. The maximum time between activation and delivery is unbounded — if the operator is actively chatting, the reminder waits.

**Flow:**
```
set_reminder("check CI", delay: 600)
  → goes to DEFERRED queue (fires in 10 min)

... 10 minutes pass ...
  → auto-moves to ACTIVE queue

Agent calls dequeue_update(timeout: 300)
  → queue is empty for 60 seconds
  → server checks: any ACTIVE reminders?
  → yes → returns reminder as synthetic event
```

**Immediate reminders** (no delay or `delay: 0`):
```
set_reminder("check worker health")
  → goes straight to ACTIVE queue
  → fires on next 60s idle window
```

### Delivery Mechanism — Early Return Within Dequeue

**Key behavior:** Reminders fire *during* a `dequeue_update` call after 60 seconds of idle. The 60s idle threshold is the default "silence window" — if no real messages arrive for 60 seconds, active reminders get delivered.

**How it works:**

1. Agent calls `dequeue_update(timeout: 300)`, queue is empty
2. Server calculates: when is the soonest event?
   - Soonest deferred→active promotion time
   - Active reminders already waiting (fire after 60s idle)
   - The dequeue timeout itself
3. Uses `min(all_of_these)` as the actual wait time
4. When the timer fires:
   - Check for newly-promoted deferred→active reminders
   - If 60s of idle has passed and active reminders exist → deliver them
   - Otherwise → continue waiting (or return timeout)
5. The reminder is delivered as a synthetic event:
   ```json
   {
     "id": -100,
     "event": "reminder",
     "from": "system",
     "content": {
       "type": "reminder",
       "text": "Check if CI passed for commit abc1234",
       "reminder_id": "ci-check-1",
       "recurring": false
     }
   }
   ```
6. One-shot reminders are deleted after firing
7. Recurring reminders reset their timer (re-enter deferred if `delay_seconds > 0`, otherwise stay active)
8. If a real message arrives at any point, it takes priority — the idle timer resets

**Default idle threshold:** 60 seconds (configurable per reminder? TBD)**

### State Module: `reminder-state.ts`

- `Map<number, Reminder[]>` keyed by SID (per-session, all in-memory)
- Reminder object: `{ id, text, delay_seconds, recurring, created_at, activated_at, state: 'deferred'|'active' }`
- Functions: `addReminder()`, `cancelReminder()`, `listReminders()`, `promoteDeferred()`, `getActiveReminders()`, `resetReminderTimer()`
- Reminders cleared when session closes

## Scope

### Files to Create
- `src/reminder-state.ts` — state management
- `src/reminder-state.test.ts` — unit tests
- `src/tools/set_reminder.ts` — MCP tool
- `src/tools/set_reminder.test.ts` — tool tests
- `src/tools/cancel_reminder.ts` — MCP tool
- `src/tools/cancel_reminder.test.ts` — tool tests
- `src/tools/list_reminders.ts` — MCP tool
- `src/tools/list_reminders.test.ts` — tool tests

### Files to Modify
- `src/server.ts` — register new tools
- `src/poller.ts` or dequeue handler — inject reminder check on timeout
- `changelog/unreleased.md` — feature entry
- `docs/super-tools.md` — document reminder tools

## Open Questions

- ~~Should reminders fire only on idle timeout?~~ **Resolved: Yes — 60s idle window within dequeue_update.**
- Should the idle threshold (60s) be configurable per reminder or globally?
- Should the operator be able to see/manage agent reminders?
- Max reminders per session? (Suggest: 20)
- Should recurring reminders have a max repeat count?
- Should reminders support absolute time ("remind at 3pm") or only relative delays?

## Priority

High — enables reliable self-prompting and process monitoring without manual discipline.
