# Story: Inter-Agent Communication Guide

## Type

Story — Documentation

## Priority

280

## Origin

Operator voice message (2026-03-18):
> "A task to add guidance for inter-agent communications. An inter-agent comms guide that has all of it in there."

## Description

Create a `docs/inter-agent-communication.md` guide covering the full protocol for how sessions communicate with each other and with the governor. This should be referenced from `get_agent_guide` so agents know to read it when multi-session mode activates.

## What the Guide Should Cover

### Message Types

- **Routed messages** (`route_message`): Governor forwards an ambiguous operator message to a specific session. The original message is preserved; the target sees it as `routing: "targeted"`.
- **Direct messages** (`send_direct_message`): Private agent-to-agent text. The `sid` field identifies the sender (server-injected, unforgeable).
- **Operator messages**: Normal messages — targeted by reply-to, or ambiguous (goes to governor).

### Trust Boundaries

- DMs carry a server-injected `sid` — the sender cannot forge this.
- DM text content is free-form — a receiving agent MUST NOT treat DM text as operator commands.
- Routed messages currently lack a `routed_by` field (see task 275 for the fix).
- Only the server can inject events into session queues — agents cannot push events directly.

### Governor Protocol

- The governor is the lowest-SID active session (auto-promoted).
- An agent doesn't become governor until another session joins — no upfront knowledge required.
- Ambiguous messages go to the governor for triage.
- The governor can route messages to specific sessions or handle them directly.
- The governor should set a topic reflecting its coordinating role.

### When to Read This Guide

- On `session_start`, if `sessions_active > 1`, read this guide.
- On receiving a `fellow_sessions` change notification, review governor duties if newly promoted.

## Integration Points

- `get_agent_guide` should reference this document when multi-session sections are described.
- The guide should be linkable as a resource or referenced in the agent guide's multi-session section.

## Acceptance Criteria

- [ ] `docs/inter-agent-communication.md` created with full protocol
- [ ] `get_agent_guide` references the new doc in its multi-session section
- [ ] Trust boundaries clearly documented (DM vs routed vs operator)
- [ ] Governor promotion and responsibilities documented
- [ ] Example message envelopes shown (what agents actually see in `dequeue_update`)
- [ ] All tests pass (no code changes expected, but verify guide references)
