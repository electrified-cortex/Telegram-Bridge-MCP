# 011 — Fix Lint Errors

**Priority:** 15  
**Status:** Queued  
**Scope:** 4 files

## Problem

96 ESLint errors across 4 files. Build passes but lint fails. These are pre-existing from recent feature additions.

## Files & Issues

### `src/reminder-state.test.ts`
- Unused `vi` import
- `await` of non-Promise (`set/cancel/clear` functions return void, not Promise)
- Unnecessary type assertions

### `src/tools/list_reminders.test.ts`
- Unnecessary type assertions (8 instances)

### `src/tools/set_reaction.ts` + `set_reaction.test.ts`
- Unnecessary type assertions
- Forbidden non-null assertions (lines 195, 218)
- Unnecessary conditional (line 101 — value is always truthy)

### `src/voice-state.test.ts`
- Unused `vi` import
- `await` of non-Promise (`set/clear/get` functions return void, not Promise)

## Acceptance Criteria

- `pnpm lint` passes with 0 errors
- `pnpm test` still passes (all 1571 tests)
- No functional changes — lint-only fixes
