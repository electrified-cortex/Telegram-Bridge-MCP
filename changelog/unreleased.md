# [Unreleased]

## Added

- `save_profile` tool — snapshot session voice, animation default/presets, and reminders to a JSON profile file
- `load_profile` tool — sparse-merge a saved profile into the current session (voice, animations, reminders)
- `src/profile-store.ts` — profile path resolution, read/write utilities with path traversal protection
- `session_start` response includes `profile_hint` field directing agents to call `load_profile`
- `data/` added to `.gitignore` (runtime profiles are gitignored by default)

## Fixed

- `save_profile` now rejects path keys (keys containing `/`); only bare keys accepted — prevents tool-written files outside the gitignored `data/profiles/` tier
- `save_profile` now includes reminder `id` in saved profiles, allowing `load_profile` to replace existing reminders by ID instead of creating duplicates on repeated loads
- `load_profile` apply section now wrapped in try/catch; returns `REMINDER_LIMIT_EXCEEDED` or `APPLY_FAILED` error instead of propagating exceptions
- `save_profile` / `load_profile` renamed session variable `sid` → `_sid` to match codebase convention
- `docs/session-profiles.md`: fixed `delay_min` → `delay_seconds` in file format example
- `docs/session-profiles.md`: fixed `delay` → `delay_seconds` in before/after example
