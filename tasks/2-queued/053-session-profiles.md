# Task 053 — Session Profiles (v4.6.0)

**Type:** Feature
**Priority:** 20

## Summary

Implement `save_profile` and `load_profile` tools that persist session configuration (voice, animation defaults/presets, reminders) to JSON files and restore them on demand. See `docs/session-profiles.md` for the full design.

## Context

Sessions are ephemeral — all state is lost on server restart. Agents must re-call `set_voice`, `set_default_animation`, and `set_reminder` (often 6+ tool calls) every time. Profiles eliminate this by capturing state to disk and restoring it in one call.

## Key Files

| File | Role |
| --- | --- |
| `src/voice-state.ts` | Per-session voice (`Map<number, string>`) |
| `src/animation-state.ts` | Per-session default frames + named presets |
| `src/reminder-state.ts` | Per-session reminders (two-tier: deferred/active) |
| `src/tools/set_voice.ts` | Existing voice tool |
| `src/tools/set_default_animation.ts` | Existing animation tool |
| `src/tools/set_reminder.ts` | Existing reminder tool |
| `docs/session-profiles.md` | Design doc (already committed) |

## Requirements

### 1. Profile storage module (`src/profile-store.ts`)

- `resolveProfilePath(key: string): string` — bare key → `data/profiles/{key}.json`; path key (contains `/`) → `{key}.json` relative to repo root.
- Reject `..`, absolute paths, null bytes.
- `readProfile(key: string): ProfileData | null` — read and parse, return null if not found.
- `writeProfile(key: string, data: ProfileData): void` — write to resolved path, create directories as needed.

### 2. Profile data shape

```typescript
interface ProfileData {
  voice?: string;
  animation_default?: string[];
  animation_presets?: Record<string, string[]>;
  reminders?: ReminderDef[];
}

interface ReminderDef {
  id?: string;
  text: string;
  delay_seconds: number;
  recurring: boolean;
}
```

All fields optional. Unknown fields are ignored on load (forward compatibility).

### 3. `save_profile` tool (`src/tools/save_profile.ts`)

- Input: `key` (string, required), `identity` (auth).
- Reads current session state: `getSessionVoiceFor(sid)`, `getDefaultFrames(sid)`, `listPresets(sid)`, `listReminders()`.
- Writes to resolved path (always `data/profiles/` for bare keys).
- Returns: `{ saved: true, key, path, sections: [...] }` listing which sections were captured.

### 4. `load_profile` tool (`src/tools/load_profile.ts`)

- Input: `key` (string, required), `identity` (auth).
- Reads profile JSON. Returns error if not found.
- Sparse merge into current session:
  - `voice` → `setSessionVoice(voice)`
  - `animation_default` → `setSessionDefault(sid, frames)`
  - `animation_presets` → `registerPreset(sid, name, frames)` for each entry (additive — does not clear existing presets not in the profile)
  - `reminders` → `addReminder(...)` for each entry (additive — does not cancel existing reminders not in the profile)
- Returns: `{ loaded: true, key, applied: { voice, animation_default, presets: [...], reminders: [...] } }`.

### 5. `session_start` hint

Add to `session_start` response: `"profile_hint": "Call load_profile(key) to restore saved session configuration."`.

### 6. `.gitignore` update

Add `data/` to `.gitignore`.

### 7. Registration

Register both tools in `src/server.ts`.

## Acceptance Criteria

1. `save_profile("test")` captures voice + animation + reminders to `data/profiles/test.json`.
2. `load_profile("test")` restores all into a fresh session.
3. `load_profile("profiles/Overseer")` loads from checked-in `profiles/Overseer.json`.
4. Two sequential loads stack (sparse merge, no wipe).
5. Path traversal keys (`../etc/passwd`) rejected.
6. Missing profile returns a clear error, not a crash.
7. `session_start` response includes profile hint.
8. Tests cover: save/load round-trip, sparse merge, path resolution, path traversal rejection, missing profile.
9. Build and lint clean. All existing tests pass.

## Version

Bump to **4.6.0** (minor — new feature).

## Supersedes

- Backlog task `40-016-session-persistence.md` (spike) — this task implements the design.
- Backlog task `40-029-animation-persistence.md` — covered by animation preset persistence in profiles.
