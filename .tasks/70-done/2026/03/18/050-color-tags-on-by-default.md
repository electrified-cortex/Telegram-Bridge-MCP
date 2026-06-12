# Color Tags On by Default

**Type:** Feature Change
**Priority:** 050 (Critical — design decision)

## Description

Session color tags must be **on by default** — not behind a feature flag. If there's a name tag (multi-session mode), it always has a color. Remove the feature flag and make colors unconditional.

## Current Behavior

- `isSessionColorTagsEnabled()` checks a config flag, defaults to `false`
- `buildHeader()` only prepends color when the flag is `true`

## Desired Behavior

- Remove `sessionColorTags` config option and `isSessionColorTagsEnabled()` / `setSessionColorTags()`
- `buildHeader()` always prepends color when in multi-session mode and session has a color
- Sessions always get a color assigned on creation

## Code Path

- `src/config.ts` — remove `sessionColorTags` field, `isSessionColorTagsEnabled()`, `setSessionColorTags()`
- `src/outbound-proxy.ts` — `buildHeader()`: remove the feature flag check, always use color
- `src/outbound-proxy.test.ts` — update tests: remove flag toggle tests, color is always on
- `docs/multi-session.md` — remove feature flag mention

## Acceptance Criteria

- [x] No `sessionColorTags` config option exists
- [x] `buildHeader()` always uses color in multi-session mode
- [x] Tests updated — no flag toggling, color always present
- [x] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated (skipped per worker rules)

## Completion

- Removed `sessionColorTags?: boolean` from `McpConfig` interface in `src/config.ts`
- Removed `isSessionColorTagsEnabled()` and `setSessionColorTags()` from `src/config.ts`
- Simplified `buildHeader()` in `src/outbound-proxy.ts`: `const colorPrefix = session?.color ? \`${session.color} \` : ""`
- Removed `vi.mock("./config.js")` and `isSessionColorTagsEnabled` mock from `src/outbound-proxy.test.ts`
- Rewrote 3 color tests → 2 tests (no flag toggling)
- Updated `docs/multi-session.md`: removed "when enabled" condition and `### Feature Flag` subsection
- 78 files, 1473 tests pass. Lint clean. Build clean.
