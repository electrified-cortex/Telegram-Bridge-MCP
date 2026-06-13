# Task #029: Server-Side Animation Persistence

**Priority:** 40 | **Status:** Draft

## Problem

Custom animation presets created via `set_default_animation` are lost on server restart. Sessions must re-create them every time.

## Requirements

1. Persist custom preset definitions server-side (file or DB)
2. On server startup, restore all saved presets
3. On `session_start` reconnect, session's custom presets are immediately available

## Scope

- `src/animation-state.ts` — persistence layer for presets
- Storage format TBD (JSON file, SQLite, etc.)

## Related

- Task #028: Worker animation identity (docs — tells workers to create presets)
