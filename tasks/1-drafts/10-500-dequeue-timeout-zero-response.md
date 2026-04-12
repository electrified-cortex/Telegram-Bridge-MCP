---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-500
Source: Operator directive (dogfooding critique)
---

# 10-500: Simplify dequeue timeout-zero response

## Objective

When `dequeue(timeout: 0)` is called (instant poll / peek mode), the
response should not include `timed_out: true`. The agent explicitly asked
for an immediate poll — there's no "timeout" to report.

## Context

Current behavior: `dequeue(timeout: 0)` returns `{ timed_out: true, pending: 0 }`
when there are no messages. The `timed_out` field is misleading — the agent
didn't time out, it asked for an instant check.

Expected: `{ empty: true, pending: 0 }` (or just `{ pending: 0 }`).

Note: some code paths already return `{ empty: true }` — this task unifies
the timeout-zero path to match.

## Acceptance Criteria

- [ ] `dequeue(timeout: 0)` with no messages returns `{ empty: true, pending: 0 }`
- [ ] `timed_out` field NOT present in timeout-zero responses
- [ ] Non-zero timeout responses unchanged (still report `timed_out: true`)
- [ ] Tests updated for new response shape
