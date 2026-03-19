# Story: Service Messages for Session Lifecycle Events

## Type

Story — Spike / Feature

## Priority

285

## Origin

Operator voice message (2026-03-18):
> "Service messages that go out to individual agents when certain things happen. A new agent started, you are the governor, you'll be getting messages routed to you."

## Problem

When a new session joins, existing sessions have no way to know. They only discover fellow sessions on their next `dequeue_update` loop — and even then, only through the response data, not through an explicit notification. There's no push mechanism to tell the governor "you are now the governor" or tell a worker "ambiguous messages go to session 1."

## Current Behavior

- `session_start` returns `fellow_sessions` to the NEW session
- The governor SID is set internally (`setGovernorSid`)
- DM permissions are auto-granted between sessions
- Existing sessions are NOT notified when a new session joins
- Existing sessions are NOT notified when a session closes
- No concept of "service messages" in the queue system

## Proposed Behavior

Inject server-generated **service messages** into session queues when lifecycle events occur. These are clearly marked as system-originated (not from the operator, not from another agent).

### Event Types

| Event | Recipients | Message |
| --- | --- | --- |
| Session joined | All existing sessions | "Session 'Scout' (SID 2) has joined. You are the governor — ambiguous messages will be routed to you." |
| Session joined | The new session | "You are SID 2. Session 1 ('Primary') is the governor. Ambiguous messages go to them." |
| Session closed | All remaining sessions | "Session 'Scout' (SID 2) has ended." |
| Governor promoted | The newly promoted session | "You are now the governor (SID 1 closed). Ambiguous messages will be routed to you." |

### Message Format in Queue

```json
{
  "id": -100,
  "event": "service_message",
  "from": "system",
  "content": {
    "type": "service",
    "text": "Session 'Scout' (SID 2) has joined. You are the governor.",
    "event_type": "session_joined",
    "details": { "sid": 2, "name": "Scout" }
  }
}
```

The `from: "system"` field distinguishes these from operator messages (`from: "user"`) and DMs (`from: "bot"`).

### Agent Behavior

- Service messages are informational — agents should read them and adjust behavior accordingly
- No response required (unlike operator messages)
- Agents should NOT route or forward service messages
- The structured `details` field lets agents programmatically react (e.g., read the inter-agent comms guide on governor promotion)

## Acceptance Criteria

- [ ] Service messages injected into session queues on join/leave/promotion
- [ ] `from: "system"` field clearly marks them as server-generated
- [ ] `event_type` field for programmatic handling
- [ ] Existing sessions notified when new session joins
- [ ] Governor notified when promoted
- [ ] Agent guide documents service message handling
- [ ] Tests for all lifecycle event types
- [ ] All tests pass
