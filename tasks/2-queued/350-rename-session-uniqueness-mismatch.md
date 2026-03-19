# 350 — renameSession uniqueness check mismatch

**Priority:** 350 (Normal)
**Type:** Bug (docstring/behavior mismatch)
**Status:** Queued
**Created:** 2026-03-19
**Source:** PR #40 review thread `PRRT_kwDORVJb9c51X_s1`

## Problem

The `renameSession` function's docstring in `session-manager.ts` claims it validates name uniqueness (case-insensitive) and throws on conflicts, but the implementation just sets the name unconditionally.

## Code Path

- `src/session-manager.ts` L200-220: `renameSession()` function
- Docstring at L203: "Validates that the new name is not taken by another active session (case-insensitive)"
- Docstring at L208: "@throws if the new name is already taken"
- Implementation at L219: `session.name = newName;` — no uniqueness check

## Options

**Option A** (implement the check): Add a loop over `_sessions` to check for case-insensitive name collision before renaming. Throw `NAME_CONFLICT` error if taken. This matches the documented behavior and aligns with error code `NAME_CONFLICT` already defined in `telegram.ts`.

**Option B** (update the docstring): If uniqueness enforcement isn't desired, update the docstring to remove the claims about validation and throws.

## Acceptance Criteria

- [ ] Docstring matches implementation (either add the check or update the docs)
- [ ] If implementing uniqueness: test that renaming to a taken name throws/returns error
- [ ] If implementing uniqueness: test that case-insensitive matching works (e.g., "Alice" vs "alice")
- [ ] Existing rename tests still pass
- [ ] Changelog entry added
