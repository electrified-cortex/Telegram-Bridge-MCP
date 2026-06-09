---
id: 20-reminder-schedule-cron-expression
title: "reminder/schedule — cron expression support for wall-clock reliable reminders"
Created: 2026-06-09
Status: queued
Priority: 20
type: feature
Source: operator voice 70528, 2026-06-09
---

# reminder/schedule — cron expression support

## Problem

`reminder/set` uses relative `delay_seconds` anchored to session start, not wall-clock
time. A session that restarts at 2pm with a "daily at 1am" reminder fires at 2pm next day.
CronCreate (Claude Code) only fires when the REPL is idle — unreliable for active-polling
agents. Pods need reliable wall-clock-anchored scheduled events.

## Solution

Add `reminder/schedule` and `reminder/unschedule` actions that accept a standard
5-field cron expression. TMCP converts the cron expression to an internal wall-clock
timer and fires the reminder as a dequeue event at the scheduled time.

## New actions

### `reminder/schedule`

**Input:**
```json
{
  "token": <session-token>,
  "id": "optional-dedup-key",
  "cron": "0 1 * * *",
  "text": "daily-check: verify monitors are active"
}
```

**Behavior:**
- Parses cron expression into the next wall-clock fire time
- Stores as a scheduled reminder in the session (and profile if saved)
- At fire time, enqueues the `text` as a reminder event in the session's dequeue stream
- After firing, computes next fire time from cron expression and re-arms (recurring)
- Cron expression is stored (not just the next fire offset) so it survives restarts correctly

**Response:**
```json
{
  "ok": true,
  "id": "optional-dedup-key",
  "next_fire": "2026-06-10T08:00:00-07:00"
}
```

### `reminder/unschedule`

**Input:** `{ "token": ..., "id": "dedup-key" }` OR by text match

**Behavior:** Cancels the named scheduled reminder. Equivalent to `reminder/cancel` for
cron-scheduled reminders.

## Profile persistence

Cron-scheduled reminders are stored in the profile with the cron expression string (not
as `delay_seconds`). On profile load / session reconnect, TMCP recomputes the next fire
time from the cron expression and re-arms. No drift.

```json
{
  "reminders": [
    {
      "id": "daily-monitor-check",
      "cron": "0 1 * * *",
      "text": "daily-check: verify monitors are active"
    }
  ]
}
```

## Timezone

Use the session's configured TZ (from compose.yaml env or profile). Default: UTC.

## Implementation notes

1. Add a cron parser (lightweight — 5-field only, no seconds). Options: write minimal
   parser or import `cron-parser` npm package.
2. Extend `Reminder` type with `cron?: string` field alongside existing `delay_seconds`.
3. Scheduled reminder tick: TMCP internal setInterval (or setTimeout chain) fires when
   `Date.now() >= next_fire_epoch_ms`, enqueues to session dequeue, recomputes next fire.
4. Profile format: add `cron` field to the reminder serialization in `profile-store.ts`.
5. On profile load (`apply.ts`): if reminder has `cron`, recompute `next_fire` from cron
   expression + TZ; ignore stored `delay_seconds` if present.

## Acceptance criteria

- [ ] `reminder/schedule` with `cron: "0 1 * * *"` fires the reminder at 1am daily wall-clock time
- [ ] After a session restart + profile load, the reminder re-arms for the correct next 1am
- [ ] `reminder/unschedule` cancels the scheduled reminder
- [ ] Cron-scheduled reminders appear in `reminder/list` output
- [ ] Fires via dequeue (not REPL notification) — reliable for agents in active DQ loops
- [ ] Existing `reminder/set` behavior unchanged

## Delegation / gates

Worker implements; Overseer reviews; Curator stages; operator commits.
