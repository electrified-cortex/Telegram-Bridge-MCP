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

## Completion

**Date:** 2026-03-22

### Files Created

- `src/profile-store.ts` — `resolveProfilePath`, `readProfile`, `writeProfile`, `ProfileData`, `ReminderDef` interfaces
- `src/tools/save_profile.ts` — `save_profile` tool (snapshots voice, animation_default, animation_presets, reminders)
- `src/tools/load_profile.ts` — `load_profile` tool (sparse-merges profile into current session)
- `src/profile-store.test.ts` — 17 tests covering path resolution, security validation, read/write, round-trip

### Files Modified

- `src/server.ts` — imported and registered `save_profile` and `load_profile`
- `src/tools/session_start.ts` — added `profile_hint` to the result object
- `src/tools/session_start.test.ts` — updated two exact-equality tests to include `profile_hint`
- `.gitignore` — added `data/` line
- `changelog/unreleased.md` — documented all additions

### Results

- Build: clean (`pnpm build`)
- Tests: 1687/1687 passed, 91 test files (`pnpm test`)
- Lint: clean (`pnpm lint`)

### Notes

- Path traversal (`..`), absolute paths, and null bytes are rejected in `resolveProfilePath`
- Bare keys (no `/`) → `data/profiles/{key}.json` (gitignored); path keys (contain `/`) → relative to repo root
- `animation_default` is always snapshotted (includes built-in default if no custom was set)
- Sparse merge on load: present keys overwrite, absent keys untouched; multiple loads stack
- Version bump deferred to operator as instructed

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

## Completion

**Date:** 2026-03-22
**Status:** Done

### Changes made

| File | Change |
| --- | --- |
| `src/voice-state.ts` | Added `_speeds` map; added `getSessionSpeed`, `setSessionSpeed`, `clearSessionSpeed`, `getSessionSpeedFor`; updated `resetVoiceStateForTest` to clear speeds |
| `src/tools/set_voice.ts` | Added optional `speed` parameter (0.25–4.0); calls `setSessionSpeed`/`clearSessionSpeed`; includes speed in return value |
| `src/tts.ts` | Added `speed?: number` to `synthesizeHttpToOgg` and `synthesizeToOgg`; injects `speed` into request body when set and not 1.0 |
| `src/tools/send_text_as_voice.ts` | Imported `getSessionSpeed`; resolves and passes `resolvedSpeed` to `synthesizeToOgg` |
| `src/built-in-commands.ts` | Imported `getSessionSpeed`; resolves and passes speed to `synthesizeToOgg` in `sendVoiceSample` |
| `src/profile-store.ts` | Added `voice_speed?: number` to `ProfileData` interface |
| `src/tools/save_profile.ts` | Imported `getSessionSpeedFor`; captures speed and adds `voice_speed` to profile data |
| `src/tools/load_profile.ts` | Imported `setSessionSpeed`; restores `voice_speed` from profile |
| `docs/session-profiles.md` | Added `voice_speed` to Captures list and file format example |
| `changelog/unreleased.md` | Added entries for `set_voice` speed param and `voice_speed` profile support |
| `src/tts.test.ts` | Added 3 tests: speed included in body, omitted when absent, omitted when 1.0 |
| `src/tools/send_text_as_voice.test.ts` | Updated `synthesizeToOgg` call assertions to 3 args; added `getSessionSpeed` mock; added 2 speed pass-through tests |
| `src/tools/set_voice.test.ts` | Added speed mocks (`getSessionSpeed`, `setSessionSpeed`, `clearSessionSpeed`) to voice-state mock |
| `src/profile-store.test.ts` | Added round-trip test including `voice_speed` |
| `src/built-in-commands.test.ts` | Added `voice-state.js` mock with `getSessionSpeed`; updated `synthesizeToOgg` assertion to 3 args |

### Test results

- **Build:** pass
- **Tests:** 1693 passed (1693)
- **Lint:** pass (no output)

### New tests added

- `tts.test.ts`: 3 new (speed in body, speed omitted when absent, speed omitted at 1.0)
- `send_text_as_voice.test.ts`: 2 new (session speed passed through, undefined when no speed)
- `profile-store.test.ts`: 1 new (round-trip including voice_speed)
