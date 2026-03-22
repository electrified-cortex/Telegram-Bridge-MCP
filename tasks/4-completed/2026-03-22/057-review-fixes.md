# Task 057: PR #78 Adversarial Review Fixes

Fix critical and major bugs found during adversarial code review of PR #78.

## Critical Fixes

### 1. TTS speed sent as JSON string instead of number

**File:** `src/tts.ts` line ~202
**Bug:** `body: Record<string, string>` forces `String(speed)`, sending `{"speed": "1.5"}` instead of `{"speed": 1.5}`. OpenAI TTS API expects a number.
**Fix:** Change body type to `Record<string, string | number>` and assign `body.speed = speed` (without `String()`).
**Test fix:** `src/tts.test.ts` — any assertion checking `body.speed` should expect a number (`1.5`), not a string (`"1.5"`).

### 2. `REMINDER_LIMIT_EXCEEDED` error code is dead code

**File:** `src/tools/load_profile.ts` line ~106
**Bug:** `message.includes("MAX_REMINDERS_PER_SESSION")` never matches because the actual error in `src/reminder-state.ts` line ~62 is `"Max reminders per session (${MAX_REMINDERS_PER_SESSION}) reached"`. The literal `MAX_REMINDERS_PER_SESSION` never appears in the thrown message.
**Fix:** Change the check to `message.includes("Max reminders per session")`.

## Major Fixes

### 3. Partial state in `load_profile` — no rollback on failure

**File:** `src/tools/load_profile.ts` lines ~50-108
**Bug:** `voice` and `voice_speed` are applied before the try/catch. If animation/reminder application throws, voice is committed but the tool returns an error.
**Fix:** Move voice/speed application inside the existing try/catch block (lines 62-108).

### 4. Windows drive-relative path bypass in `resolveProfilePath`

**File:** `src/profile-store.ts` line ~44-54
**Bug:** On Windows, `C:test` passes all validation (`isAbsolute()` returns false, no `..`, no `/`) but `resolve(REPO_ROOT, "data", "profiles", "C:test.json")` resolves to `C:\data\profiles\test.json` — outside the repo.
**Fix:** Also reject keys containing `:`.

### 5. `save_profile` doesn't reject backslash in keys

**File:** `src/tools/save_profile.ts` — wherever path key check is
**Bug:** Only checks `key.includes("/")` but `key = "test\\sub"` passes and creates subdirectories.
**Fix:** Also reject keys containing `\`.

### 6. Reconnect response missing `profile_hint`

**File:** `src/tools/session_start.ts` — the reconnect-via-name-match response path (~line 300)
**Bug:** Fresh session includes `profile_hint` but reconnect does not.
**Fix:** Add `profile_hint` to the reconnect response too.

## Out of Scope

- `set_voice("")` clearing speed — intentional coupling, just needs doc update later
- Floating-point speed comparison — low risk, skip for now
- Non-atomic file writes — low severity, skip for now
- `listReminders()` implicit SID — correct behavior, just asymmetric style

## Acceptance Criteria

- [x] All fixes implemented with correct code changes
- [x] Existing tests pass (`pnpm test`)
- [x] New or updated tests where applicable (especially for bug #1 test fix)
- [x] Update `changelog/unreleased.md` — add Fixed entries for bugs #1 and #2

## Completion

All 6 fixes implemented. Tests: 1277 passed across 54 test files (2026-03-22).

### Changes made

| Fix | File | Change |
|-----|------|--------|
| #1 TTS speed type | `src/tts.ts` | `body: Record<string, string | number>`, `body.speed = speed` (no `String()`) |
| #1 test | `src/tts.test.ts` | `expect(body.speed).toBe(1.5)` (number, not `"1.5"`) |
| #2 error string | `src/tools/load_profile.ts` | `"Max reminders per session"` (was `"MAX_REMINDERS_PER_SESSION"`) |
| #3 partial state | `src/tools/load_profile.ts` | voice/speed application moved inside try/catch |
| #4 colon in key | `src/profile-store.ts` | Reject keys containing `:` in `resolveProfilePath` |
| #5 backslash in key | `src/tools/save_profile.ts` | Reject keys containing `\` in addition to `/` |
| #6 profile_hint | `src/tools/session_start.ts` | Added `profile_hint` to reconnect-via-name-match response |
| changelog | `changelog/unreleased.md` | Added Fixed entries for all 6 bugs |

