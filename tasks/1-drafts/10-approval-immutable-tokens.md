---
Created: 2026-04-08
Status: Draft
Host: local
Priority: 10
Source: Codex swarm review finding 1
---

# Approval Identity — Use Tokens and Tickets, Not Names

## Problem

The agent approval system resolves pending approvals via `target_name` lookup,
which is user-controlled and collision-prone. If two sessions share a name,
approval could bind to the wrong session.

## Current Design

- `session_start` creates a pending approval with `target_name`
- `approve_agent` looks up by target name
- Name is user-provided (display name)

## Required Design

Per operator directive, approval uses two credentials:

1. **Token** — session identity (existing access credential, persists for session)
2. **Ticket** — one-time admission pass (transient, single-use, consumed on approve)

`approve(token, ticket)` — that's it. No name lookup.
generated at session_start, delivered to the governor via dequeue, and consumed
once.

**Delivery mechanism:** When a session requests approval, a message is
automatically broadcast as part of the dequeue event stream — sent specifically
to the governor. The message includes: session info (name, color), the ticket,
and a hint: `approve(token: <your_token>, ticket: THE_TICKET)`. The ticket is
pre-filled in the hint (just delivered), the governor substitutes their own
token. Ticket is never logged or persisted — exists only in the dequeue delivery.

## Verification

- [ ] Approval binds to token + ticket pair, not name
- [ ] Ticket is single-use (consumed on approve, rejected on reuse)
- [ ] Ticket is never logged or persisted
- [ ] Hint in dequeue delivery includes pre-filled ticket
- [ ] Existing approval tests updated
- [ ] Build, lint, test green
