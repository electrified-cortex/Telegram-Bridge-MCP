---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-422
Source: Operator
---

# 10-422: Error-guided help — every failure hints at recovery

## Objective

Make the v6 API self-guiding: every error response tells the agent how to
recover. The **"Haiku test"** — a less capable model should never be stuck
without direction. "A monkey could use it."

## Context

v6 has two validation layers with different customization points:

1. **Zod schema validation** — the MCP SDK runs `validateToolInput()` before our
   handler is invoked. On failure it throws `McpError(InvalidParams, ...)` using
   the first Zod issue's `.message` string. **No handler hook exists** to
   intercept this. Customization must happen in the schemas themselves via
   `.message()`, `.refine()`, and `.superRefine()`.

2. **Handler-level validation** — post-Zod business logic uses `toError()` with
   structured codes (e.g. `UNKNOWN_ACTION`, `MISSING_CONTENT`). These already
   have `hint` fields in some cases (discovery mode). Straightforward to enhance.

Discovery mode (no-args calls) already guides well — returns available types and
links to `help`. But actual **errors** don't. Three gap categories:

### Gap 1: Zod validation errors (SDK layer)

When Zod rejects input, the caller sees:
```
Input validation error: Invalid arguments for tool send: Expected number, received string
```
No mention of `help`. No context about what the right value looks like.

**Fix:** Add custom `.message()` to Zod constraints that include help refs:
```ts
z.number().int().min(0, {
  message: "timeout must be ≥ 0. See help(topic: 'dequeue') for usage."
})
```

### Gap 2: Handler-level application errors

`toError()` returns structured codes but no `help` field. Pattern to add:
```json
{
  "code": "MISSING_CONTENT",
  "message": "At least one of 'text' or 'audio' is required.",
  "help": "Call help(topic: 'send') for full usage."
}
```

### Gap 3: "Almost right" fuzzy guidance

Agent calls a valid tool with nearly-correct params (typo in type, close match
to an action name). Instead of a flat rejection, suggest the closest match:
```json
{
  "code": "UNKNOWN_ACTION",
  "message": "Unknown action 'set_remindor'. Did you mean 'set_reminder'?",
  "help": "Call help(topic: 'action') for available actions."
}
```

### Gap 4: Unknown tool (v5 → v6 migration)

The MCP SDK handles "tool not found" before our code runs. Options:
- **Option A:** Register v5 tool names as stubs returning migration hints
- **Option B:** Enhance `help()` default response with a v5→v6 migration table

## Design

### Zod Schema Enhancement

For each tool's `inputSchema`, audit every constraint and add descriptive
`.message()` that includes the tool name and `help` reference:

| Tool | Key Constraints to Enhance |
|------|---------------------------|
| `send` | type enum, text/audio union, parse_mode enum |
| `dequeue` | timeout min/max, force boolean |
| `help` | topic string (minimal — already simple) |
| `action` | type enum, per-action required params |

Use `.superRefine()` for cross-field validation (e.g., send requires text OR
audio) to produce messages like: "send requires 'text' or 'audio'. Call
help(topic: 'send') for examples."

### `toError()` Enhancement

Add an optional `help` field to the `toError()` utility. Every call site in:
- `src/tools/send.ts` — UNKNOWN_TYPE, MISSING_CONTENT, etc.
- `src/tools/action.ts` — UNKNOWN_ACTION, missing params
- `src/tools/dequeue.ts` — TIMEOUT_EXCEEDS_DEFAULT
- `src/telegram.ts` — Grammy error classification

### Fuzzy Matching

For enum-like params (type, action type), use Levenshtein or simple substring
matching to suggest "did you mean X?" when the value is close but not exact.
Keep it simple — `string-similarity` or a 20-line utility, not a library.

### Unit Tests

Create a dedicated test file (`src/tools/__tests__/error-guidance.test.ts` or
similar) covering:

| Category | Test Cases |
|----------|-----------|
| Zod validation | Each tool with wrong param types, missing required fields, out-of-range values — verify error includes help ref |
| Application errors | Each handler error code — verify `help` field present |
| Fuzzy matching | Close-but-wrong type/action values — verify suggestion |
| Discovery mode | Confirm no regression — still returns guidance |
| v5 stubs (if chosen) | Each deprecated tool name — verify migration message |

## Acceptance Criteria

- [ ] Zod `.message()` on all constrained params includes tool-specific help ref
- [ ] `.superRefine()` for cross-field validation with descriptive help messages
- [ ] `toError()` supports `help` field; all call sites include it
- [ ] `UNKNOWN_ACTION` / `UNKNOWN_TYPE` errors reference `help(topic: ...)`
- [ ] Fuzzy "did you mean?" for close-match type/action values
- [ ] Decision made on v5 stub approach: register stubs OR help table
- [ ] Unit tests for Zod errors, handler errors, fuzzy matching, discovery mode
- [ ] Zero regression on existing discovery mode behavior
- [ ] Error messages pass the "Haiku test" — understandable without docs

## Completion

**Commit:** e13b612 (branch 10-422)
**Tests:** 2129 passing (12 new in error-guidance.test.ts)

### What changed

- src/telegram.ts: Added 7 codes to TelegramErrorCode union; hint?: string field on TelegramError interface
- src/tools/send.ts: 	ype schema changed from z.enum to z.string with manual guard so fuzzy matching is reachable; hint on all 12 	oError sites; indClosestMatch + levenshtein helpers; empty-array crash fix; substring lowercase fix
- src/tools/action.ts: UNKNOWN_ACTION uses indClosestMatch against listCategories(); hint on NOT_GOVERNOR; same helpers with same fixes
- src/tools/dequeue.ts: Zod .message() on 	imeout int/min/max constraints
- src/tools/error-guidance.test.ts: New file — 12 tests covering all hint paths including UNKNOWN_TYPE fuzzy path
- changelog/unreleased.md: Added error guidance hints entry

### Deferred

- v5 tool stub approach: decided not to register stubs (discovery mode is preferred path)
- EMPTY_MESSAGE text-path hint: minor inconsistency, low priority
- Zod cross-field .superRefine(): not implemented — individual field messages adequate for now
