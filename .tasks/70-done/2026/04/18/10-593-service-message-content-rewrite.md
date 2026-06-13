# 10 — Service Message Content Rewrite

## Summary

Rewrite all `SERVICE_MESSAGES` constant values in `src/service-messages.ts`
to match the approved spec at `docs/service-message-content-spec.md`.

## Context

PR #141 (10-587) extracted message strings into `src/service-messages.ts`.
The content is still verbose and non-conformant. The spec (10-588) defines
exact target text: ultra-compressed, help() breadcrumbs, no pin references.

## Base Branch

Build on `10-service-message-constants-refactor` (off dev) — that branch
has the `SERVICE_MESSAGES` file. Do NOT base off main/dev until 10-587 merges.

## Requirements

Per `docs/service-message-content-spec.md`:

1. `ONBOARDING_TOKEN_SAVE` → `"Save your token to your session memory file."`
2. `ONBOARDING_ROLE_GOVERNOR` (event: `onboarding_role`) → forwarding protocol
   per spec, ends with `help('guide')`
3. Add `ONBOARDING_ROLE_PARTICIPANT` (event: `session_orientation`) → new entry,
   template: `You are SID {N}. {Governor label} is your escalation point. ...`
4. `ONBOARDING_PROTOCOL` → ultra-compressed reactions message, ends with
   `help('reactions')`
5. `ONBOARDING_BUTTONS_TEXT` → buttons-first, hybrid as footnote, ends with
   `help('send')`
6. Consolidate all governor change variants (`GOVERNOR_NOW_YOU`,
   `GOVERNOR_NO_LONGER_YOU`, `GOVERNOR_CHANGED_MSG`, `GOVERNOR_SWITCHED`,
   `GOVERNOR_PROMOTED_SINGLE`, `GOVERNOR_PROMOTED_MULTI`) →
   single `GOVERNOR_CHANGED` (event: `governor_changed`)
7. Add `SESSION_JOINED` (event: `session_joined`) per spec
8. Update `SESSION_CLOSED` / `SESSION_CLOSED_WITH_NEW_GOVERNOR` to match spec
9. All nudges (`NUDGE_*`) → one sentence + `help('topic')` pointer
10. Remove any user-facing pin/formula references
11. Ensure all callers updated to use consolidated constants (no broken refs)

## Acceptance Criteria

- [ ] All message texts match `docs/service-message-content-spec.md` exactly
- [ ] All governor variants consolidated to single `GOVERNOR_CHANGED`
- [ ] `SESSION_JOINED` added
- [ ] All nudges end with `help()` breadcrumb
- [ ] No user-facing pin/token formula references
- [ ] All existing callers compile without errors
- [ ] All tests pass

## Delegation

Worker task.
