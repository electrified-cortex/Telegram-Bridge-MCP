---
Created: 2026-04-15
Status: Queued
Host: local
Priority: 10-562
Source: Operator correction on 10-498 API surface
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

- [ ] `action(type: "log/dump")` removed from action dispatcher
- [ ] Trace data retrievable via `log/get` (or extend to support trace type)
- [ ] Trace data clearable via `log/delete` (or extend to support trace type)
- [ ] `dumpTraceToDisk()` function removed or made internal-only
- [ ] Tests updated — no tests reference `log/dump`
- [ ] Help topics updated if any reference `log/dump`
