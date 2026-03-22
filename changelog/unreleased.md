# [Unreleased]

## Changed

- Poller starts lazily on first `session_start` and stops on last `close_session`; idle MCP instances no longer consume updates
- Reminder IDs now use content hash (SHA-256 truncated to 16 hex chars) instead of random UUIDs — same `text + recurring` always produces the same ID, making profile loads idempotent
- `load_profile` output now distinguishes added vs updated reminders: `{ reminders: { added: [...], updated: [...], review_recommended? } }`

## Added

- `session_start` response includes `instructions` field with persistence and recovery guidance (save SID/PIN to session memory; call `get_chat_history` after reconnect)
- `set_voice` tool now accepts optional `speed` parameter (0.25–4.0) for per-session TTS speed control
- `voice_speed` included in profile save/load (`save_profile` captures it, `load_profile` restores it)
- `save_profile` tool — snapshot session voice, animation default/presets, and reminders to a JSON profile file
- `load_profile` tool — sparse-merge a saved profile into the current session (voice, animations, reminders)
- `src/profile-store.ts` — profile path resolution, read/write utilities with path traversal protection
- `session_start` response includes `profile_hint` field directing agents to call `load_profile`
- `data/` added to `.gitignore` (runtime profiles are gitignored by default)
- `reminderContentHash(text, recurring)` exported from `reminder-state.ts` — deterministic 16-char hex ID for reminders
- `hasSessionDefault(sid)` exported from `animation-state.ts` — check if session has custom animation default

## Fixed

- `save_profile` now rejects path keys (keys containing `/`); only bare keys accepted — prevents tool-written files outside the gitignored `data/profiles/` tier
- `save_profile` no longer saves hardcoded animation default unconditionally — only saved when the session has a custom default set
- `save_profile` no longer persists runtime reminder UUIDs — `id` is stripped from reminder serialization; profiles are templates
- `load_profile` apply section now wrapped in try/catch; returns `REMINDER_LIMIT_EXCEEDED` or `APPLY_FAILED` error instead of propagating exceptions
- `save_profile` / `load_profile` renamed session variable `sid` → `_sid` to match codebase convention
- `docs/session-profiles.md`: fixed `delay_min` → `delay_seconds` in file format example
- `docs/session-profiles.md`: fixed `delay` → `delay_seconds` in before/after example
