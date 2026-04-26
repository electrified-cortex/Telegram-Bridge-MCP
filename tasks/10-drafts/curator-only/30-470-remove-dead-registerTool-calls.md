---
Created: 2026-04-11
Status: Backlog
Host: local
Priority: 30-470
Source: Curator audit
Target: v6.0.1
---

# 30-470: Remove dead registerTool() calls from legacy tool files

## Problem

Individual tool files (choose.ts, confirm.ts, ask.ts, etc.) still contain
`server.registerTool()` calls from the pre-v6 era. These are never executed
because `server.ts` only imports 4 tool registrations: help, dequeue, send,
action.

The dead code is confusing — it looks like ~52 additional MCP tools are
registered when in reality only 4 exist.

## Proposed Fix

Remove all `server.registerTool()` calls from tool files that are NOT
imported by `server.ts`. The action dispatcher calls handler functions
directly, not through MCP tool registration.

## Acceptance Criteria

- [ ] Only 4 `server.registerTool()` calls remain (help, dequeue, send, action)
- [ ] All action-dispatched handlers still work correctly
- [ ] Tests pass
- [ ] No functional change to MCP tool surface

## Spec Revision Needed (2026-04-24)

Worker 2 escalated: `register()` functions in tool files are **live test fixtures** used
by ~50 test files (833 tests). They are NOT dead code — they register tools against a
mock server so tests can call them. The premise of this task ("remove dead registerTool
calls") is incorrect as written.

Curator must revise: either clarify the task is about production `server.ts` surface only
(leaving test-facing `register()` functions intact), or close this as won't-fix.
