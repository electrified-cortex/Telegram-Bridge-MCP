# Session Color Tags

**Type:** Feature
**Priority:** 300 (Normal)

## Description

Add a per-session color indicator to the name tag prefix in multi-session mode. The color square emoji appears **before** the bot emoji in outbound messages.

**Current format:** `🤖 \`Name\``
**New format:** `🟦 🤖 \`Name\``

## Design

### Color Palette (rainbow order)

| Index | Emoji | Suggested Role |
| --- | --- | --- |
| 0 | 🟦 | Coordinator / overseer |
| 1 | 🟩 | Builder / worker |
| 2 | 🟨 | Reviewer / QA |
| 3 | 🟧 | Research / exploration |
| 4 | 🟥 | Ops / deployment |
| 5 | 🟪 | Specialist / one-off |

Role suggestions are **conventions only** — the server does not enforce meaning.

### Assignment

- Auto-assigned in palette order by default (first session gets 🟦, second gets 🟩, etc.)
- Agent can **optionally pick** a color during `session_start` via a new `color` parameter
- If the requested color is already taken, auto-assign the next available one
- If all 6 are exhausted, loop back to the beginning — the name text still disambiguates

### Feature Flag

- This feature is **off by default** (feature flag)
- When off, behavior is unchanged — `🤖 \`Name\`` with no color prefix
- Design the flag mechanism (config field, environment variable, or runtime toggle) as appropriate

## Code Path

- `src/session-manager.ts` — `Session` interface: add `color` field. `createSession()`: accept optional `color` param, auto-assign if not provided
- `src/outbound-proxy.ts` — `buildHeader()`: prepend color square when the feature is enabled and session has a color
- `src/tools/session_start.ts` — accept optional `color` parameter
- `src/tools/list_sessions.ts` — include `color` in session info output
- `docs/multi-session.md` — document session colors, palette, and conventions

## Completion

**Status:** Done

### Changes Made

**`src/config.ts`**

- Added `sessionColorTags?: boolean` to `McpConfig` interface
- Added `isSessionColorTagsEnabled()` getter and `setSessionColorTags(enabled)` setter

**`src/session-manager.ts`**

- Added `COLOR_PALETTE` constant (`["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]`, exported)
- Added `SessionColor` type alias
- Added `color: string` field to `Session`, `SessionInfo`, `SessionCreateResult` interfaces
- Added `assignColor(requested?)` internal helper — auto-assigns next available palette color, wraps on exhaustion
- `createSession()` accepts optional `colorHint?: string` second parameter, auto-assigns when omitted or hint is taken
- `listSessions()` now includes `color` in output
- `getUnhealthySessions()` now includes `color` in output

**`src/outbound-proxy.ts`**

- Imported `isSessionColorTagsEnabled` from `config.js`
- `buildHeader()` prepends `{color} ` before `🤖` when color tags are enabled and the session has a color

**`src/tools/session_start.ts`**

- Added optional `color` parameter (emoji string from the palette)
- Passes color hint to `createSession(effectiveName, color)`

**Tests updated**

- `src/session-manager.test.ts` — imported `COLOR_PALETTE`; added `describe("color assignment")` block (6 tests: palette order, custom hint, taken hint fallback, wrap-around, listSessions includes color, getSession includes color)
- `src/outbound-proxy.test.ts` — added `isSessionColorTagsEnabled` to mocks; added config.js mock; default `false` in beforeEach; added 3 color header tests
- `src/tools/session_start.test.ts` — updated 10 `toHaveBeenCalledWith` assertions to include `undefined` as second arg

**`docs/multi-session.md`**

- Added color tag bullet to The Swarm Model list
- Added "Session Color Tags" section with palette table, assignment rules, and feature flag description

### Test Results

- 1480 tests, 79 files — all pass (was 1471/79 before this task; +9 tests)
- Lint: clean
- Build: clean
