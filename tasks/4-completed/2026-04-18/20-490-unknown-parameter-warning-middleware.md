---
id: 20-490
title: Unknown parameter warning middleware
priority: 20
type: improvement
status: backlog
created: 2026-04-11
target: v6.1+
---

# 20-490 — Unknown Parameter Warning Middleware

## Problem

When agents hallucinate parameters (e.g., `dequeue(force: true)`), the bridge silently ignores them. The agent never learns it sent a bad param. This masks LLM hallucination and causes repeated mistakes.

## Solution

Shared middleware that checks all incoming tool parameters against the tool's schema. Unknown params are stripped, and the response includes a hint:

```json
{
  "warning": "Unknown parameter 'force' was ignored. dequeue accepts: token, timeout."
}
```

## Design

- Middleware runs before every tool handler
- Compares incoming params against registered schema
- Valid params pass through unchanged
- Unknown params → stripped + warning appended to response
- Warning lists what the tool actually accepts
- Does NOT reject the call — tool still executes with valid params only

## Scope

- All tools (send, dequeue, action, help, etc.)
- Shared implementation — one middleware, not per-tool checks
- Tests: verify warning appears for unknown params, verify valid params unaffected

## Origin

Operator directive during session 2026-04-11. Originally item 12 on task 10-485 but operator designated as backlog (v6.1/6.2), not v6.0.3 scope.

## Completion

**Branch:** `20-490-unknown-param-warning` (off `dev`)
**Commit:** `f49d58d` — `feat(middleware): unknown parameter warning on all tool calls`

### What was done

- `src/unknown-param-warning.ts`: new module with `checkUnknownParams()` (strips unknown keys, builds warning string) and `injectWarningIntoResult()` (merges warning into MCP response envelope)
- `src/server.ts`: wired into `registerTool` wrapper — known params extracted once at registration, checked on every call; `cleanArgs` forwarded to all downstream handlers
- `src/unknown-param-warning.test.ts`: 18 new tests covering single/multiple unknown params, grammar, sorted accepted list, existing warning prepend, malformed payloads
- All 2385 tests pass, lint clean

**Awaiting Overseer push + PR creation.**
