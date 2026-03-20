# Task #028: Per-Session Animation Presets + Persistence

**Priority:** 25 | **Status:** Draft

## Problem

All sessions share the same animation presets (thinking, working). Workers and the governor look identical when using animations, losing the visual identity that session colors provide.

## Requirements

### Phase 1 — Per-Session Preset Overrides

1. `set_default_animation` gains a `preset` parameter — allows a session to override any named preset with custom frames
2. Overrides stored in-memory per session — if a session sets a custom "thinking" animation, only that session uses it
3. Fallback to global presets when no override exists

### Phase 2 — Persistence

1. Store preset overrides server-side (file or config)
2. On `session_start` reconnect, restore the session's preset overrides
3. Operator can set presets via Telegram commands (outside session scope)

## Scope

- `src/animation-state.ts` — preset resolution per session
- `src/tools/set_default_animation.ts` — accept preset overrides
- `src/tools/show_animation.ts` — resolve session-specific preset before display
- Persistence layer (Phase 2)

## Notes

- Could tie into session color assignment — each color palette includes default animation frames
- Frame unicode characters should be visually cohesive within a set
