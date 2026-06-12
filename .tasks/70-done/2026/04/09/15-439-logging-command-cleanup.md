---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 15-439
Source: Operator testing session
---

# /logging and /log Command Cleanup

## Objective

There are two overlapping commands: `/log` and `/logging`. Only one should exist. Additionally, the `/logging` menu has confusing button labels ("Dump", "Flush") that are developer jargon, not user-friendly.

## Context

- `/logging` opens a menu with session log mode toggles and action buttons.
- `/log` apparently still exists separately — redundant.
- "Dump" and "Flush" are internal operations that mean nothing to an operator.
- Buttons need clearer labels: e.g. "Save Log", "Export Session", "Clear Buffer" — whatever maps to the actual behavior.
- Not enough room for all buttons in the current layout.

## Acceptance Criteria

- [ ] Only one logging command exists (operator's choice — likely `/logging`)
- [ ] If `/log` is kept as alias, it routes to the same handler
- [ ] "Dump" button has a user-friendly label explaining what it does
- [ ] "Flush" button has a user-friendly label explaining what it does
- [ ] Button layout fits without overflow on mobile
- [ ] Existing tests pass
