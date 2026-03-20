# Task #033: Rename /governor Command to /primary

**Priority:** 20 | **Status:** Draft

## Problem

The `/governor` slash command is internal/technical terminology that doesn't mean much to the operator. "Primary" is a more natural concept — the operator thinks of it as "who am I primarily talking to?" not "who is the governor?"

## Goal

Rename the `/governor` Telegram slash command to `/primary`, update all human-facing text to use "primary" language, and ensure only technical/agent-facing internals retain the governor terminology.

## Scope

### `src/built-in-commands.ts`

User-facing changes only (keep internal function names, event types, and agent messages as-is):

1. `getGovernorCommandEntry()` — change command name from `"governor"` to `"primary"`, description from `"Switch the governor session"` to `"Switch the primary session"`
2. `_builtInCommandNames` set — change `"governor"` to `"primary"` (used to filter out built-in commands when building the merged command list)
3. `refreshGovernorCommand()` — change `cmd.command !== "governor"` filter to `cmd.command !== "primary"`
4. Raw command dispatch (around line 305) — change `raw === "governor"` → `raw === "primary"`
5. `buildGovernorPanel()` — update user-facing text from governor language to primary language:
   - Panel intro text: change "governor" → "primary" for the human-readable explanation
   - Confirmation message: "✅ Governor set to…" → "✅ Primary set to…"
   - No-op message: "already the governor" → "already the primary"
   - Stale panel message: reopen `/primary` instead of `/governor`
   - Guard message: "Governor selection requires…" → "Primary selection requires…"

**Do NOT change:**
- Internal function names (`handleGovernorCommand`, `handleGovernorCallback`, `buildGovernorPanel`, etc.)
- Callback data strings (`"governor:set:"`, `"governor:dismiss"`) — internal, not user-visible
- `_activePanels` map type literal — internal
- Service message event types (`"governor_changed"`, `"governor_promoted"`) — agent-facing
- Agent-to-agent messages ("You are now the governor", etc.) — agent-facing, not human-facing

### Documentation

- `README.md` — update any `/governor` references in the command list to `/primary`
- `docs/behavior.md` — update user-facing `/governor` references to `/primary`; keep internal docs that explain the routing concept using "governor" if they're technical

### Tests

- `src/built-in-commands.test.ts` — update command name in tests from `"governor"` to `"primary"`

## Acceptance Criteria

- `/primary` appears in the Telegram command menu instead of `/governor` when 2+ sessions are active
- The panel correctly shows current primary (with ✓) and allows switching
- All user-visible text in the panel uses "primary" terminology

## Completion

- Implemented in `src/built-in-commands.ts` — command name, descriptions, and all user-facing panel text updated to "primary"; internal function names, callback data, and agent messages preserved as "governor"
- Tests updated in `src/built-in-commands.test.ts` and `src/tools/set_commands.test.ts`
- All 47 test files pass (1146 tests)
- Changelog updated in `changelog/unreleased.md`
- Commit: `47c953c` on dev — "feat: rename /governor command to /primary for operator UX (#033)"
- Agent-to-agent service messages still use "governor" internally (no behavior change)
- All tests pass
