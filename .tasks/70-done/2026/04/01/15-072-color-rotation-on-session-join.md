# Task: Color Rotation on Session Join

**Created:** 2026-04-01
**Status:** queued
**GitHub Issue:** #105

## Objective

When a new session joins, rotate the color picker so already-used colors appear last
instead of being filtered out. The first "fresh" color gets the primary button style.

## Context

Currently the color picker shows available vs taken colors. The proposed change:
1. All colors remain selectable (workers can share colors).
2. Colors used by active sessions sorted to end of list.
3. First (freshest) color gets primary button style for quick selection.
4. Agent files now specify default colors (`session_start(color: "🟥")` etc.), which
   hint the preferred color. The rotation should respect this hint — if the agent
   requests a specific color, that color should be pre-selected/first regardless of
   whether it's already in use.

## Acceptance Criteria

1. Color picker sorts used colors to end, fresh colors first.
2. First fresh color gets primary button style.
3. `color` parameter in `session_start` is respected as a preference hint — placed first.
4. All colors remain selectable (no filtering).

## Notes

- See GitHub issue #105 for full spec.
- Worker must use a worktree for this implementation.

## Completion

**Status:** complete
**Date:** 2026-04-01
**Worker:** Worker 2

Changed files:
- `src/session-manager.ts` — `getAvailableColors`: now returns all 6 colors always; fresh first, used last; hint placed first regardless of used/fresh status
- `src/tools/session_start.ts` — `requestApproval`: primary button goes to hint if fresh, otherwise first fresh color; falls back to no primary when all taken
- `src/session-manager.test.ts` — updated 3 tests to match new "all 6 returned" behavior
- `src/tools/session_start.test.ts` — added 3 new tests: no-hint primary, hint-is-fresh primary, hint-is-used primary

All 1762 tests pass. Code review: clean.
