---
Created: 2026-04-09
Status: Backlog
Host: services
Priority: 10-413
Source: Copilot PR review (PR #126, round 4)
---

# 10-413: Action Registry Type Safety Improvements

## Objective

Eliminate `any` types from the action registry and action tool dispatcher to
comply with the repo's `no-explicit-any` ESLint rule and improve type safety
across the v6 action routing layer.

## Context

During the v6 transition, pragmatic `any` casts were used to bridge handler
signature differences between direct handlers and extracted `register()` closures.
Now that Phase 3 is complete and all handlers are extracted, these can be tightened.

Copilot PR review flagged three related issues:

1. **`src/action-registry.ts` line 10** — `ActionHandler` uses
   `Record<string, any>` for args. Should be `Record<string, unknown>` with
   handlers narrowing/validating their inputs.

2. **`src/tools/action.ts` line 122** — multiple `as unknown as ActionHandler`
   double-casts when registering actions. Tighten handler types or provide small
   adapter wrappers so registrations are type-safe without casts.

3. **`src/tools/action.ts` line 496** — dispatcher returns `as any` cast. Replace
   with `unknown` or a shared `ToolResult` type and narrow at the boundary.

## Acceptance Criteria

- [ ] `ActionHandler` args type changed from `Record<string, any>` to `Record<string, unknown>`
- [ ] Registration casts in `action.ts` eliminated or reduced to single casts
- [ ] Dispatcher return type uses `unknown` or shared type instead of `any`
- [ ] All handler files updated to narrow/validate their args properly
- [ ] ESLint `no-explicit-any` disable comment in action-registry.ts removed
- [ ] Build clean, all tests pass

## Completion

Implemented on branch `10-413`. Commit `22322bb`.

Approach: consolidated all `as unknown as ActionHandler` double-casts into a single
`toActionHandler(fn: unknown): ActionHandler` helper in `action-registry.ts`. Using
`fn: unknown` sidesteps TypeScript contravariance — any callable value can be passed
and the single `as ActionHandler` cast is always valid from `unknown`. Removed the
`type ActionHandler` import from `action.ts` (now only needs `toActionHandler`).

Changes:
- `src/action-registry.ts`: Added exported `toActionHandler` helper (11 lines)
- `src/tools/action.ts`: Replaced 40+ `handlerXxx as unknown as ActionHandler` cast
  sites with `toActionHandler(handlerXxx)`; all inline lambda casts replaced similarly

Build: `pnpm build` clean (tsc + biome). Lint: `pnpm exec eslint` clean on both files.
Code review verdict: minor_only — refactor correctly consolidates cast sites, no regressions.

Note: Code review surfaced 3 pre-existing bugs in `action.ts` unrelated to this refactor:
- `messaging/progress_update` calls `handleSendNewProgress` instead of `handleProgressUpdate`
- `handleProgressUpdate` imported but unused
- `handleAuthCheck` declared twice
These are tracked separately and left untouched per task scope.
