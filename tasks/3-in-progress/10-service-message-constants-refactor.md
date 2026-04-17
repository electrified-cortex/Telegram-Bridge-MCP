# 10 — Service Message Constants Refactor

## Summary

Extract all inline service message strings from TMCP handler code into
a centralized constants file. Create a spec for what each message should
say and why.

## Context

Service messages (onboarding_protocol, onboarding_buttons, onboarding_role,
onboarding_token_save, behavior_nudge_*, etc.) are currently embedded as
inline strings deep in handler code (session_start.ts, behavioral-shaping
module). This makes them hard to audit, review, and maintain.

Operator directive: move all messages to constants at top of file or
co-located with help topics. Each message needs a spec defining what it
should say and why.

## Requirements

1. Audit all service message strings in the codebase:
   - session_start.ts (onboarding messages)
   - behavioral shaping module (nudge messages)
   - Any other files with deliverServiceMessage calls
2. Produce an inventory: message name, current text, source file, line
3. Create `src/service-messages/` directory (or similar central location)
4. Extract each message string into a named constant
5. Replace inline strings with constant references
6. All tests must pass after refactor

## Out of Scope

- Changing message content (that's a separate task with its own spec)
- Creating help topics (separate task)
- Behavioral shaping logic changes

## Acceptance Criteria

- [ ] All service messages inventoried
- [ ] Constants extracted to central location
- [ ] No inline message strings remain in handler code
- [ ] All 2367+ tests pass
- [ ] PR created

## Delegation

Worker task. Mechanical refactoring — no content changes.
