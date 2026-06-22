---
title: "Blocking question two-timeout model — decouple DQ wait from question lifetime"
priority: 15
status: draft
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
dispatch_ready: false
needs_operator: false
created: 2026-06-21
source: operator-voice-77350-77382
---

# Blocking question: two-timeout model

## Problem

The current blocking-question model conflates two separate concepts:
1. **DQ wait** — how long the agent blocks waiting for an answer (~90s session default)
2. **Question lifetime** — how long the question itself is valid

When the DQ wait expires, the agent unblocks and continues. But the question (especially if pinned) should remain answerable indefinitely unless an explicit `timeout_seconds` is set.

Currently these two clocks are not decoupled, causing agents to block indefinitely.

## Design

### Clock 1 — DQ wait (agent-side)
- How long the agent blocks waiting for an answer.
- Default: session's `dequeue_default` max_wait (~90s).
- When it fires: agent receives `timed_out: true` from dequeue and **continues execution** — NOT a failure.
- The question is NOT expired just because the agent stopped waiting.

### Clock 2 — Question lifetime (question-side)
- How long the question itself is valid in the chat.
- Default: **no timeout** — questions stay live indefinitely unless `timeout_seconds` is explicitly provided.
- Rationale: pinned questions persist in the chat. A question without a timeout should remain answerable.

### Late-answer routing (RESOLVED: Option A)
When a pinned question is answered after the agent has already moved on, two things always fire together:
- An **SSE notify event** is emitted — this is the wake signal that wakes any active agent monitor (e.g. a sleeping `Monitor` call).
- The answer is delivered as a **`callback_response` message** in the session's normal dequeue queue — this is the payload the agent reads.

The SSE notify is the wake mechanism; dequeue delivers the payload. Both always fire — they are not alternatives.

This is consistent with the existing SSE notification pattern: any operator action (clicking a button, answering a question) always triggers an SSE notify AND enqueues the result through the normal dequeue channel, even if the agent is currently idle. No new mechanism is needed beyond the existing `callback_response` type and SSE notify infrastructure.

## Acceptance criteria

AC1. `send(type: "question", ...)` DQ wait defaults to session's `dequeue_default` max_wait, not a fixed timeout.
AC2. When DQ wait fires, agent receives `timed_out: true` and continues. Question is NOT closed.
AC3. Question stays pinned (if pinned) until explicitly answered, timed out (only if `timeout_seconds` set), or cancelled.
AC4. When operator answers a pinned question after agent moved on: (a) an SSE notify event fires to wake any active monitor, AND (b) the answer arrives as `callback_response` in the agent's next dequeue call. Both always fire — the notify wakes, dequeue delivers.
AC5. Existing `timeout_seconds` param on `send(type: "question")` = question lifetime expiry; when it fires, question is unpinned and marked expired.
AC6. `max_wait` on dequeue = DQ wait clock; unchanged.
AC7. The two clocks operate independently — DQ wait firing does NOT close the question.

## Related
- `feat-auto-pin-blocking-questions.md` (40-queued): auto-pin on send; unpin on answer OR question expiry
- The unpin must happen on answer regardless of whether agent timed out waiting or not.

## Out of scope
- Callback_response message shape (existing spec covers this)
- Non-blocking question variants (existing `choice`/`choose` already non-blocking)
