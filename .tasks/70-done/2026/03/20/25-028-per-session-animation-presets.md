# Task #028: Worker Animation Identity (Docs)

**Priority:** 25 | **Status:** Draft

## Problem

Workers use the same animation presets as the overseer (thinking, working), making them visually indistinguishable in the chat.

## Solution

Update worker instructions to encourage creating distinctive custom presets:

1. On session start, call `set_default_animation` with unique preset names (e.g., `worker:thinking`, `worker:working`) using different unicode frames
2. Store custom preset definitions in session memory so they survive compaction
3. Use these custom presets for `show_animation` calls instead of the built-in ones

## Scope

- `.github/instructions/worker-rules.instructions.md` — add animation identity guidance
- `docs/communication.md` — add section on worker animation conventions
- Example preset definitions for workers to copy

## Completion

**Commit:** `ce9d213`
**Date:** 2026-03-20

### What was done
Updated `.github/agents/worker.agent.md` Animation Presets section:

- Preset names now embed the worker's session name via `{name}` placeholder (e.g., `Worker: thinking`)
- 2-frame hourglass animation: `⏳ {name}: state…` / `⌛ {name}: state…`, `interval_ms=2000`
- Template block shown as copy-paste `set_default_animation` calls for all 4 states
- `show_animation` references updated to use `{name}: state` pattern

No changes to `worker-rules.instructions.md` (no animation content there) or `docs/communication.md` (scope narrowed to agent spec per operator direction).

### Acceptance Criteria
- [x] Workers visually distinct from overseer and each other via name-stamped presets
- [x] Template shown in agent spec for easy copy-paste at bootstrap
- [x] 2-second interval — slow enough to be visible, not distracting
