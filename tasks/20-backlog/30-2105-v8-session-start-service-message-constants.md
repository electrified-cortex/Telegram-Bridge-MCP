---
Created: 2026-05-27
Status: backlog
Priority: low
Source: 2026-05-27 refactor scan
---

# session/start.ts — Use SERVICE_MESSAGES constants in reconnect path

## Problem

`src/tools/session/start.ts:542` — The reconnect path uses inline hardcoded strings for service message text instead of `SERVICE_MESSAGES` constants. If messaging strategy changes, these inline strings will drift from the canonical constant definitions.

## Action

1. Identify the inline string literals in the reconnect service message path (around line 542).
2. Replace each with the appropriate `SERVICE_MESSAGES` constant (or add a new constant if missing).
3. Verify the reconnect path produces identical output before and after.

## Acceptance Criteria

- [ ] No inline message strings in the reconnect path of `session/start.ts`.
- [ ] All service messages reference `SERVICE_MESSAGES` constants.
- [ ] Tests pass.
