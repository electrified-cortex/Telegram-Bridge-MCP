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
   user-facing text (help topics, onboarding, etc.). PIN generation
   formula must NOT appear in any user-facing surface. Code comments
   are acceptable — the token is opaque to agents.

## Branch

`10-service-message-constants-refactor` (PR #141)

## Acceptance Criteria

- [x] `deliverServiceMessage` accepts constant objects directly
- [x] All call sites pass objects, not separate `.text`/`.eventType`
- [x] No PIN references in user-facing text
- [x] ONBOARDING_TOKEN_SAVE simplified
- [x] Tests pass (2367/0)

## Completion

**Worker 4 — 2026-04-18**

Branch: `10-596-service-message-constant-passthrough`
Commit: `5110601`
Worktree: `.worktrees/10-596-service-message-constant-passthrough`

### What was done

- `src/session-queue.ts`: added object-form overload to `deliverServiceMessage` — callers can pass `{ eventType, text }` constant directly; legacy string form still supported
- `src/service-messages.ts`: simplified `ONBOARDING_TOKEN_SAVE.text` to "Save your token to your session memory file now."
- `src/session-gate.ts`: removed PIN formula from `SID_REQUIRED` user-facing error
- `src/tools/list_sessions.ts`: replaced PIN formula in token param description
- `src/shutdown.ts`, `session-teardown.ts`, `built-in-commands.ts`, `health-check.ts`, `session_start.ts`: updated all call sites to use object form (14 files total)
- Tests updated across 5 test files — 2367 tests pass, build clean

**Awaiting Overseer pipeline move + Curator push/PR.**
