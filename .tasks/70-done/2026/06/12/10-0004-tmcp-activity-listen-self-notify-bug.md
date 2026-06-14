---
created: 2026-06-12
status: draft
priority: 10
source: inventory-new-tmcp
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-0004 — Fix activity/listen self-notify false trigger

## Context

The `activity/listen` SSE endpoint fires events when the subscribing agent itself sends a message or reaction, not only when inbound activity arrives. This causes agents to wake spuriously on their own output, degrading signal quality and wasting tokens. The bug was logged in `tasks/00-ideas/tmcp-activity-listen-self-notify-bug-2026-06-10.md`.

## Objective

Modify the `activity/listen` handler to filter out events originating from the authenticated sender, ensuring the SSE stream only delivers events caused by external parties.

## Acceptance Criteria

1. Sending a message while subscribed to `activity/listen` does not produce an SSE event on the same connection.
2. Adding a reaction to a message does not produce an SSE event on the same `activity/listen` connection.
3. Inbound messages from another user do produce an SSE event on the subscriber's connection.
4. Existing integration tests pass after the fix.
5. No regression in the `activity/listen` breadcrumb delivery (05-0003).

## Scope boundary

- Modifies the `activity/listen` SSE filter logic only.
- Does not change the event schema or the SSE wire format.
- Does not address the `activity/listen/check` endpoint addition (tracked separately in 10-0006).

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 10 — high

## Operator clarification (2026-06-12)

SSE is a notifier only — it fires when there is something to dequeue; it does not deliver message content. The subscriber should only receive SSE kicks for events that would appear in **their own** dequeue queue:

- No self-notifications (own sends/reactions) — already in original AC
- **No cross-session notifications** — events targeted to OTHER sessions must NOT produce an SSE event for this subscriber
- Only events that would appear in this session's dequeue (ambiguous + targeted-to-me) should trigger the SSE notification

"It shouldn't be getting things that other sessions are getting." — Operator directive.

## Verification

APPROVED 2026-06-12 — Verifier confirmed all 5 ACs + operator cross-session clarification: originatorSid parameter added to notifySession, enqueueToSession and broadcast path pass event.sid, self-events suppressed without consuming debounce gate, 11 new tests (7 unit + 4 integration), 3433/3433 pass. Commit c94ff78e.

Sealed-By: foreman
