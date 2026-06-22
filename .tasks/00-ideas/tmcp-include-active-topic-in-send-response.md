---
captured: 2026-06-21
source: operator (TG 77791)
---

# Include active topic in send/action responses when topic is set

## Operator request

The operator requested that the active topic be included in the send response whenever a topic has been previously set.

## Intent

When a `profile/topic` is active, the agent should be aware that its outbound messages are being prefixed. Currently the topic is set via `action(type: 'profile/topic')` but there is no confirmation in subsequent `send` or `action` responses that the topic prefix is still active.

## Proposed behaviour

When a topic is set in the session profile, include it in the response of:
- `send` — e.g. `{ message_id: ..., topic: "Triage" }`
- Possibly `action` responses where topic affects outbound content

This makes the topic visible at the point of action so the agent knows the prefix is still in effect, without having to call `profile/topic` separately to check.

## Notes

- Low overhead — just include the active topic string in the response envelope when non-null
- Helps agents notice stale topics (operator saw "[Triage]" lingering after triage was done)
- Could also surface in `session/list` or a `profile/status` action
