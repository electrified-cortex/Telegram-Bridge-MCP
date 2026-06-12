---
id: 30-2300
title: "Bug: last_received reminder timer resets on ambiguously-routed messages not targeted at this session"
Created: 2026-06-03
Status: draft
Priority: medium
type: Bug
Source: Operator report 2026-06-03 (voice msg 66944)
Delegation: Worker
---

## Symptom

A `reminder/set` with `trigger: last_received` and `only_if_silent: true` never fires
when the agent is actively sending messages — even if the operator's recent messages
were routed ambiguously (not targeted at this session) and therefore not truly "received"
by this session in the conversational sense.

## Root cause hypothesis

The TMCP bridge's `last_received` clock is reset by ANY dequeue event tagged from the
user — including ambiguous messages that appear in this session's dequeue because they
were not explicitly targeted. When the operator messages another session (e.g. Curator)
and the message routes ambiguously, it lands in all sessions' dequeue queues and resets
their `last_received` timers.

This causes `only_if_silent` reminders to be suppressed even when the agent is actually
idle-relative-to-the-operator in a meaningful sense.

## Expected behavior

`last_received` should reset only on messages where:

- `routing == "targeted"` (the message was explicitly directed at this session), OR
- `from == "user"` AND the message is a direct reply to something this session sent

Ambiguously-routed messages (routing == "ambiguous") that arrive in this session as a
side effect of routing should NOT reset the `last_received` timer for this session.

## Workaround

Use `only_if_silent: false` — reminder fires unconditionally after the delay. Misses the
"only bother them if I haven't already replied" ergonomic but avoids the suppression bug.

## Acceptance criteria

- [ ] AC1: A reminder with `trigger: last_received`, `delay_seconds: 600`, `only_if_silent: true`
       fires after 10 minutes of the operator sending no messages TARGETED at this session,
       even if the operator sent messages to other sessions during that window.
- [ ] AC2: If the operator sends a message routed as `targeted` to this session, the timer resets.
- [ ] AC3: If the operator sends a message routed as `ambiguous` to all sessions, the timer
       does NOT reset for sessions that did not reply to that message.

## Notes

- Operator observed: reminder set as `only_if_silent: true` with `last_received` trigger
  was being suppressed because ambiguous messages (operator → Curator, routed to all)
  were resetting the timer on the Overseer session.
- Workaround applied: changed to `only_if_silent: false`.
