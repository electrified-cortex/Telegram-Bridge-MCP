# 10 — 596 — Service message constant passthrough + PIN removal

## Summary

Two issues on PR #141 (service message constants refactor):

1. **Double destructuring**: Constants bundle `{ eventType, text }` but callers
   still pass them separately: `deliverServiceMessage(sid, MSG.text, MSG.eventType)`.
   The function should accept the whole constant object directly.

2. **PIN still referenced**: Line 24 of service-messages.ts still says
   "Token = sid * 1_000_000 + pin." The onboarding token save message should
   just say: "Save your token to your session memory file now."
   Audit ALL references to "PIN" across the codebase and remove them from
   user-facing text.

## Requirements

1. Add an overload to `deliverServiceMessage` that accepts
   `(sid, msg: { eventType: string, text: string }, details?)` — extract
   text and eventType internally
2. Update all call sites to pass the constant object directly instead of
   destructuring `.text` and `.eventType`
3. Simplify `ONBOARDING_TOKEN_SAVE.text` to:
   `"Save your token to your session memory file now."`
4. Audit and remove all PIN references from service messages and
   user-facing text (help topics, onboarding, etc.)

## Branch

`10-service-message-constants-refactor` (PR #141)

## Acceptance Criteria

- [ ] `deliverServiceMessage` accepts constant objects directly
- [ ] All call sites pass objects, not separate `.text`/`.eventType`
- [ ] No PIN references in user-facing text
- [ ] ONBOARDING_TOKEN_SAVE simplified
- [ ] Tests pass
