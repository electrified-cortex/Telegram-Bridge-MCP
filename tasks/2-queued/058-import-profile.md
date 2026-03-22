# Task 058: import_profile Tool + Voice Speed Update

## Overview

Add an `import_profile` tool that accepts profile data inline (as tool parameters) instead of reading from a file. This lets agents load profiles from external sources (URLs, other repos) without needing a file on disk.

## Implementation

### 1. Extract shared apply logic

**File:** `src/tools/apply-profile.ts` (new)

Extract the profile application logic from `load_profile.ts` (~lines 50-115) into a reusable function:

```typescript
export function applyProfile(
  sid: number,
  profile: ProfileData,
): { applied: Record<string, unknown> } | { error: { code: string; message: string } }
```

This function should:
- Apply voice, voice_speed, animation_default, animation_presets, reminders
- Return `{ applied: {...} }` on success or `{ error: { code, message } }` on failure
- Use the same try/catch, content-hash IDs, added/updated tracking, etc.

### 2. Create `import_profile` tool

**File:** `src/tools/import_profile.ts` (new)

Tool name: `import_profile`

Parameters (all optional — sparse merge):
- `voice` (string) — voice name
- `voice_speed` (number, 0.25–4.0) — TTS speed
- `animation_default` (string[]) — default animation frames
- `animation_presets` (Record<string, string[]>) — named presets
- `reminders` (array of `{ text, delay_seconds, recurring }`)
- `identity` — standard identity schema

The tool constructs a `ProfileData` object from the provided params and calls `applyProfile()`.

### 3. Refactor `load_profile` to use shared apply logic

**File:** `src/tools/load_profile.ts`

Replace the inline apply logic with a call to `applyProfile(sid, profile)`. Keep the file-reading logic (readProfile, key resolution) in load_profile.

### 4. Register the new tool

**File:** `src/server.ts`

Import and register `import_profile`.

### 5. Tests

**File:** `src/tools/import_profile.test.ts` (new)

Key test cases:
- Imports voice and speed
- Imports animation presets
- Imports reminders with content-hash IDs
- Sparse merge — missing keys don't clear existing state
- Auth required
- Returns applied summary

### 6. Update profiles voice speed

**Files:** `profiles/Overseer.json`, `profiles/Worker.json`

Change `voice_speed` from `1.25` to `1.1` in both profiles.

### 7. Changelog

Add to `changelog/unreleased.md`:

```
## Added

- `import_profile` tool — apply profile data inline without reading from disk; accepts same structure as profile JSON files

## Changed

- Default voice speed updated from 1.25x to 1.1x in Overseer and Worker profiles
```

## Acceptance Criteria

- [ ] `import_profile` tool exists and works
- [ ] `load_profile` refactored to use shared apply logic (no behavior change)
- [ ] All existing tests pass (`pnpm test`)
- [ ] New tests for `import_profile`
- [ ] Voice speed updated to 1.1 in both profiles
- [ ] Changelog updated
