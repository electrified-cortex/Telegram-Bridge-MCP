---
Created: 2026-04-15
Status: In Progress
Host: local
Priority: 10-562
Source: Operator correction on 10-498 API surface
Assignee: Worker 1
---

# 10-562: Remove log/dump — use log/get + log/delete pattern

## Objective

Remove `action(type: "log/dump")` from the trace system. Trace data
should follow the same pattern as regular logs: `log/get` to read,
`log/delete` to clear.

## Context

10-498 implemented `log/dump` for writing the trace buffer to disk.
Operator directive: "there should not be a log dump... it's either
log/get and log/delete as a 2 step process." The dump action was
implemented due to contradictory criteria in the task doc (Curator error).

## Acceptance Criteria

- [x] `action(type: "log/dump")` removed from action dispatcher
- [x] Trace data retrievable via `log/trace` (already existed)
- [x] Trace data clearable via `log/delete` with `filename: "trace"` (new special case)
- [x] `dumpTraceToDisk()` function removed; replaced with `clearTraceLog()` export
- [x] Tests updated — no tests reference `log/dump`; `dumpTraceToDisk` suite replaced
- [x] No help topics referenced `log/dump`

## Completion

- **Branch:** `10-562`
- **Commit:** `8455bf6`
- **Worktree:** `Telegram MCP/.worktrees/10-562`
- **Completed:** 2026-04-15

Removed `log/dump` action and `dumpTraceToDisk()`. New workflow: `log/trace` to read, `log/delete` with `filename: "trace"` to clear the in-memory buffer (calls new `clearTraceLog()` export). Removed unused fs imports and `formatTimestamp` from `trace-log.ts`. 6 files changed. Build passes, 2257 tests pass (110 files), eslint clean.
