# Task: Improve identity schema error when string is passed instead of array

**Created:** 2026-04-03
**Priority:** 10
**Status:** completed
**Completed:** 2026-04-03
**Assigned:** Worker 2 (SID 3)
**Repo:** electricessence/Telegram-Bridge-MCP
**Branch target:** dev

## Problem

When a caller passes `identity` as a string (e.g. `"[1, 852999]"`) instead of a JSON array
(`[1, 852999]`), the MCP framework rejects the call at the schema validation layer with a
generic Zod/JSON Schema error:

```
MCP error -32602: Input validation error: Invalid arguments for tool load_profile: [
  {
    "expected": "array",
    "code": "invalid_type",
    "path": ["identity"],
    "message": "Invalid input: expected array, received string"
  }
]
```

This error bypasses the tool handler entirely — the improved identity error messages from
PR #109 never fire because the request is rejected upstream by the schema validator.

## Root Cause

The `identity` parameter is declared as `type: "array"` in the tool's JSON Schema (via Zod).
The MCP framework validates inputs against this schema before calling the handler. Strings are
rejected at that layer with a generic message.

## Fix

For every MCP tool that accepts an `identity` parameter, change the Zod schema for `identity`
from a strict array type to `z.unknown()` (or `z.union([z.array(...), z.string(), z.unknown()])`),
then validate inside the handler and return a targeted error when a string is detected:

> *"identity must be a JSON array [sid, pin], not a string — pass `identity: [1, 852999]`,
> not `identity: \"[1, 852999]\"`"*

The handler-level validation should:
1. Check if value is a string → return the specific string-passed error with example
2. Check if value is not an array → return "identity must be a JSON array [sid, pin]"
3. Check if array length !== 2 or elements aren't numbers → return specific format error
4. Otherwise proceed as normal

## Scope

- Find all tool definitions in `src/tools/` that declare an `identity` parameter
- Update the Zod schema for `identity` in each to accept unknown input
- Add handler-level validation with targeted error messages
- Update tests to cover the string-passed case

## Acceptance Criteria

- [x] Passing `identity: "[1, 852999]"` (string) returns a clear, actionable error message
- [x] Passing `identity: [1, 852999]` (array) continues to work as before
- [x] Tests cover the string identity case for at least one tool (e.g. `dequeue_update`)
- [x] All existing tests pass
- [x] Typecheck clean

## Completion

**Completed by:** Worker 2 (SID 3)
**Date:** 2026-04-03
**Branch:** `task/10-178-identity-schema-string-error`
**Commits:** `66c6897` (main implementation), `e0c95ed` (review fixes)

### What was done

- `src/tools/identity-schema.ts` — Changed `IDENTITY_SCHEMA` from `z.array(z.number().int())` to `z.unknown()` so the MCP framework passes string identity through to the handler instead of rejecting with a generic -32602 error.
- `src/session-gate.ts` — `requireAuth()` signature widened to `unknown`; added string detection branch returning `INVALID_IDENTITY` with static actionable message.
- `src/telegram.ts` — Added `INVALID_IDENTITY` to `TelegramErrorCode` union.
- `src/tools/confirm.ts` — Updated `identity` interface type to `unknown`.
- Tests: 4 new tests in `session-gate.test.ts`, 1 new test in `dequeue_update.test.ts`, updated `identity-schema.test.ts` to reflect `z.unknown()` behavior.

### Code review summary

- Round 1: 2 Major findings (error message embeds raw input; missing validateSession guard) — both fixed.
- Round 2: CLEAN — no Critical or Major findings.
- Minor findings noted (pre-existing patterns, optional follow-up coverage) — no action required.

### Test results

1792 tests passed, typecheck clean.
