---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-498
Source: Operator directive (dogfooding critique)
---

# 10-498: Debug tracing — behavioral audit log

## Objective

Implement maximum debug tracing for all agent actions. Memory-only (not
persisted to disk by default). Serves as a behavioral audit trail / lie
detector — enables verifying whether agents actually performed claimed
actions (e.g., "did the Overseer fire and act on its reminders?").

## Context

Currently the bridge has `get_debug_log` and `toggle_logging` tools, but
the existing debug log is limited in scope and not designed for behavioral
auditing.

Operator directive: "maximum debug logging. Audit debug logs: they should
be memory only. Tracing for everything so you can do things like look and
see if the overseer got their reminders and acted on it. Basically helping
as a lie detector."

Use case: Deputy (Curator's scan/audit arm) queries the debug log to
verify agent behavior. "Did Worker 3 actually call dequeue after being
told to?" "Did Overseer act on reminder X?"

## Design

### What to trace

Every tool invocation, with:
- Timestamp
- Session ID + name
- Tool name
- Key parameters (sanitized — no tokens)
- Result summary (success/error, not full payload)
- Event type for non-tool events (reminder fired, message received, etc.)

### Storage

- **In-memory ring buffer** — fixed size (e.g., last 10,000 entries)
- **No disk persistence by default** — avoids log bloat
- Optional: `action(type: 'debug/dump')` to write current buffer to disk on demand

### Query interface

Enhance existing `get_debug_log` with filtering:

```json
{
  "type": "debug/query",
  "token": "...",
  "filter": {
    "session": 2,
    "tool": "dequeue",
    "since": "2026-04-12T10:00:00Z",
    "limit": 50
  }
}
```

Returns matching trace entries. Supports filtering by session, tool, time range.

### Access control

- Governor can query any session's traces
- Non-governor can only query own session's traces
- Operator (via Telegram commands) can query all traces

## Acceptance Criteria

- [ ] All tool invocations recorded in memory with timestamp, SID, tool name, params, result
- [ ] Non-tool events traced: reminder fires, message delivery, session lifecycle
- [ ] Ring buffer with configurable size (default 10K entries)
- [ ] No disk writes unless explicitly requested
- [ ] `get_debug_log` enhanced with session/tool/time filtering
- [ ] Governor can query all sessions; non-governor limited to own
- [ ] Token values excluded from trace entries (sanitized)
- [ ] Trace entries include enough detail to verify "did agent X do Y?"

## Notes

- Operator explicitly called this "a lie detector" — the query interface
  must support behavioral verification, not just log tailing.
- Deputy is a primary consumer: auditing whether Overseer/Workers followed
  through on commitments.
- Existing `get_debug_log` and `toggle_logging` tools should be evolved,
  not replaced.
