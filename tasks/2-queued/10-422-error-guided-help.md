---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-422
Source: Operator
---

# 10-422: Error-guided help — every failure hints at recovery

## Objective

Make the v6 API self-guiding: every error response should tell the agent how to
recover. The "Haiku test" — a less capable model should never be stuck without
direction.

## Context

Currently, v6 tool errors return raw Zod messages or application error codes
without any guidance. Discovery mode (calling tools with no args) already works
well — it returns available types and links to `help`. But actual ERRORS don't
guide the agent. Three gaps:

1. **Unknown tool** — agent calls a v5 name like `show_animation`. They get a
   hard MCP "tool not found" error with zero context about what replaced it.
2. **Wrong params** — Zod rejects or handler error. Agent gets the error but no
   hint to call `help(topic: "send")` for usage.
3. **Wrong type/action** — agent calls `action(type: "nonexistent")`. Gets
   `UNKNOWN_ACTION` with self-referential "try action()" hint but no mention of
   `help`.

## Design

### Scenario 1: Unknown tool (v5 → v6 migration)

This is the hardest — the MCP SDK handles "tool not found" before our code runs.
Options:
- Register v5 tool names as stubs that return migration hints
- Or: Include a v5→v6 migration table in the `help()` default response

### Scenario 2: Application-level errors

Append a help hint to every error response. Pattern:

```json
{
  "code": "MISSING_CONTENT",
  "message": "At least one of 'text' or 'audio' is required.",
  "help": "Call help(topic: \"send\") for full usage."
}
```

### Scenario 3: Unknown type/action path

Already partially implemented via discovery mode. Enhance `UNKNOWN_ACTION` and
`UNKNOWN_TYPE` errors to include `help` reference.

## Acceptance Criteria

- [ ] All application-level errors include a `help` field with the relevant topic
- [ ] `UNKNOWN_ACTION` errors reference `help(topic: "action")`
- [ ] `UNKNOWN_TYPE` errors on `send` reference `help(topic: "send")`
- [ ] `MISSING_PARAM` errors reference the relevant help topic
- [ ] Decision made on v5 stub approach: register stubs OR enhance help default
- [ ] Tests verify help hints appear in error responses
- [ ] Zero regression on existing discovery mode behavior
