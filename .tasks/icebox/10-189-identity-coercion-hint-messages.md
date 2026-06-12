---
Created: 2026-04-03
Status: icebox
Host: local
Priority: 10
Source: Operator directive
Repo: Telegram MCP
Note: Superseded by 10-178. Iced 2026-04-03.
---

# Identity Coercion Hint Messages

## Objective

When the Telegram MCP coerces a string identity to an array, append a hint to
the tool response telling the agent to use the native tuple format.

## Context

Commit `96482e9` added silent string-to-array coercion in
`src/tools/identity-schema.ts` via Zod `z.preprocess()`. This lets agents
pass `"[2, 573602]"` instead of `[2, 573602]` without errors. But agents
never learn the correct format because the coercion is invisible.

The operator wants a non-intrusive hint in the response object (not in the
messages array) that educates agents on proper usage.

## Scope

### 1. Signal coercion in the identity schema

Modify `src/tools/identity-schema.ts` to signal when coercion happened. Options:

- Return the coerced value and set a flag on a shared context/request object
- Use a Zod `.transform()` that wraps the value in `{ value, coerced: true }`
  and unwrap downstream

The simplest approach: add a mutable context parameter that the preprocess
step sets, then check it in the tool handler.

### 2. Append hint to tool responses

When coercion was detected, add a `_hint` field (or similar) to the response
data object before calling `toResult()`. The hint should include the actual
sid and pin values from the coerced identity, so the agent sees the correct
format with their own credentials. Example:

```json
{
  "message_id": 21775,
  "_hint": "identity must be an array: identity: [2, 573602] — not a string. All tool calls accept [sid, pin] tuples."
}
```

For `dequeue_update` specifically:

```json
{
  "updates": [...],
  "pending": 3,
  "_hint": "identity must be an array: identity: [2, 573602] — not a string. All tool calls accept [sid, pin] tuples."
}
```

The hint appears once at the response level, not per-message.

### 3. Apply to all tools

Every tool that accepts `identity` should check for coercion and append the
hint. This includes: `session_start` (if applicable), `dequeue_update`,
`send_message`, `send_text`, `send_text_as_voice`, `send_direct_message`,
`get_message`, `get_chat_history`, `list_sessions`, `answer_callback_query`,
and all others.

### 4. Tests

- Test that string identity coerces successfully (existing test may cover)
- Test that coerced responses include `_hint` field
- Test that native tuple responses do NOT include `_hint`
- Test `dequeue_update` specifically: hint appears once at response level
- Test several representative tools (send_message, list_sessions, etc.)

## Acceptance Criteria

- [ ] String identity coercion continues to work as before
- [ ] When coercion happens, response includes a `_hint` field
- [ ] When native tuple is used, no `_hint` field appears
- [ ] `dequeue_update` hint is at response level, not per-update
- [ ] Tests cover coerced vs native identity for at least 3 tools
- [ ] All existing tests pass

## Quality Bar

Write clean, idiomatic TypeScript. The coercion signal mechanism should be
minimal — avoid over-engineering. A simple flag on the parsed args or a
shared context object is sufficient.

## Reversal Plan

Revert the commits. No schema changes, no data migration needed.

## Icebox Note

**Superseded by task 10-178** (completed 2026-04-03).

10-178 replaced silent coercion (`z.preprocess`) with `z.unknown()` + handler-level validation.
Strings passed as identity now return an `INVALID_IDENTITY` error with an explicit actionable
message ("pass `identity: [1, 852999]`, not a string"). The hint this task would have added
is already embedded in that error response. Re-introducing coercion would partially revert
10-178's deliberate design.

If coercion-with-hint is ever reconsidered as a product direction, revisit then.
