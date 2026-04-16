---
Created: 2026-04-13
Status: Queued
Host: local
Priority: 10-508
Source: Operator
---

# Add `message` as parameter alias for `text` in send tool

## Objective

Add `message` as a parameter alias for `text` in the `send` tool. When an agent calls `send(message: "hello")`, it should resolve to `send(text: "hello")` and succeed — but include a hint in the response indicating the canonical parameter name.

## Context

Agents naturally reach for `send(message: "...")` because "send a message" is the logical mental model. Currently this fails with an unknown parameter error. The fix is to accept `message` as an alias for `text` and return a hint (similar to the error message format) guiding agents toward the canonical `text` parameter.

This follows the existing alias pattern in the codebase (e.g., `direct` → `dm` for type aliases). The difference here is that `message` is a **parameter alias**, not a type alias.

Note: For plain text/audio sends, `type` may not even be required — agents can call `send(text: "...")` or `send(audio: "...")` directly. The `message` alias should work the same way.

## Implementation Notes

- `message` is a parameter alias for `text`, not a type alias.
- When `message` is present and `text` is not, copy value to `text` before dispatching.
- If both `message` and `text` are provided, `text` takes precedence.
- Success response must include a `hint` field with the same kind of guidance the error message would have given — e.g., `'message' is accepted as an alias. Canonical parameter: 'text'.`
- Zod schema: `message` should be an accepted but undocumented parameter (passthrough or explicit optional field).
- Build with `pnpm build` (or `npm run build`) and verify before committing.

## Acceptance Criteria

- [x] `send(message: "hello")` delivers a text message successfully
- [x] Response includes a `hint` field noting `message` is an alias for `text`
- [x] `send(text: "hello", message: "world")` uses `text` value, ignores `message`
- [x] `send(message: "hello", audio: "spoken text")` works (voice with caption)
- [x] Existing `send(text: "...")` behavior unchanged
- [x] Build passes (`pnpm build` or `npm run build`)

## Completion

- **Branch:** `10-508`
- **Commit:** `7eb4d0f`
- **Worktree:** `Telegram MCP/.worktrees/10-508`
- **Completed:** 2026-04-15

Resolved alias at handler entry (`text = args.text ?? args.message`). Hint injected into all return paths when alias was used. Schema description updated. 4 new tests. Build passes, 2223 tests pass (109 files).
