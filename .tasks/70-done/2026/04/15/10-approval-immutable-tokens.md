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

- [x] Approval binds to token + ticket pair, not name
- [x] Ticket is single-use (consumed on approve, rejected on reuse)
- [x] Ticket is never logged or persisted
- [x] Hint in dequeue delivery includes pre-filled ticket
- [x] Existing approval tests updated
- [x] Build, lint, test green

## Completion

- **Branch:** `10-approval`
- **Commit:** `7bc1a21`
- **Worktree:** `Telegram MCP/.worktrees/10-approval`
- **Completed:** 2026-04-15

**Files changed (7):** `agent-approval.ts`, `tools/approve_agent.ts`, `tools/session_start.ts`, `tools/action.ts`, `agent-approval.test.ts`, `tools/approve_agent.test.ts`, `tools/session_start.test.ts`

Ticket is a 16-byte hex string generated at `registerPendingApproval`, stored only in `_pending` (keyed by ticket), and delivered to the governor via dequeue service message with hint `action(type: 'approve', token: <your_token>, ticket: THE_TICKET)`. Never logged to stderr. Build passes, 2219 tests pass, eslint clean.
