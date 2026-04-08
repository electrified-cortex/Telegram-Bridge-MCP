# 10-205: Rename `voice` to `audio` in unified send tool

**Priority:** 10 (critical)
**Scope:** `src/tools/send.ts`, `src/tools/confirm.ts`, `src/tools/choose.ts`, docs
**Branch:** `dev`

## Problem

The unified `send` tool uses `voice` as the parameter name for TTS content. This causes confusion:
- `voice: "hello"` looks like selecting a voice named "hello", but it's actually the spoken text
- The voice *name* is buried inside the object form `{text, voice, speed}`
- Agents pass voice names as strings (e.g., `voice: "am_onyx"`) expecting voice selection, getting literal TTS of "am onyx"

## Spec

Rename the `voice` parameter to `audio` across the send API surface:

### Parameter changes

**Before:**
```
send(text: "caption", voice: "spoken content")
send(text: "caption", voice: { text: "spoken", voice: "am_onyx", speed: 1.1 })
```

**After:**
```
send(text: "caption", audio: "spoken content")
send(text: "caption", audio: { text: "spoken", voice: "am_onyx", speed: 1.1 })
```

### Semantics (unchanged)
- `text` only → text message
- `audio` only → TTS voice note
- `text` + `audio` → voice note with text as caption

### Files to change
1. `src/tools/send.ts` — rename `voice` schema key to `audio`, update description, update handler destructuring and all references
2. `src/tools/confirm.ts` — if it has a `voice` input for TTS mode, rename to `audio`
3. `src/tools/choose.ts` — same pattern
4. Update tool descriptions in all three files
5. `changelog/unreleased.md` — add Changed entry

### NOT in scope
- `set_voice` tool (configures TTS voice settings — different concept, keeps name)
- `getSessionVoice()` / `getDefaultVoice()` internals (voice config, not content)
- Voice name parameter INSIDE the audio object stays `voice` (it IS selecting a voice)

## Acceptance criteria
- [ ] `send(audio: "hello")` produces a voice note
- [ ] `send(text: "hi", audio: "hello")` produces voice with caption
- [ ] `send(audio: {text: "hello", voice: "am_onyx"})` uses specified voice
- [ ] Old `voice` parameter no longer accepted (breaking change — acceptable for pre-release)
- [ ] Tool descriptions updated
- [ ] Changelog entry added
- [ ] `npm run build` passes

## Reversal
Rename `audio` back to `voice` in the same files. Pure rename, no logic changes.
