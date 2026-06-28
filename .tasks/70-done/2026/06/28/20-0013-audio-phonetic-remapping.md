---
type: feature-spec / draft
priority: P2
source: TG 81092 — 2026-06-28
status: queued
relates-to: audio send, TTS pipeline
---

# TMCP — Audio Phonetic Remapping

## Problem

TTS engines pronounce certain words incorrectly because the spelling doesn't match the intended phonetics. Example: "Zhu-Li" (proper spelling) is mispronounced by the current TTS voice. The desired pronunciation is "Joo-Lee."

This affects any word or name that has a non-phonetic spelling: proper nouns, brand names, technical terms, foreign names, agent names, etc. The list will grow over time.

## Feature

Pre-TTS substitution step: before audio text is sent to TTS, apply a configurable phonetic substitution map. Words/phrases in the map are replaced with their phonetic equivalents. The substituted text goes to TTS; the original text is preserved for caption/logging purposes.

## Substitution Map — Per-Profile (TG 81099 clarification)

Remappings are **per-profile**, not global. Each agent/profile has its own independent phonetic substitution map. One agent's mapping table has no effect on another agent's audio output.

Map location: Profile config — alongside other profile-level settings. Scoped to the profile, not to TMCP globally.

Case-insensitive matching — output uses the replacement string as-is (e.g. key `"zhu-li"` or `"Zhu-Li"` → replacement `"Joo-Lee"` verbatim). Ordered to handle overlapping matches (longer match wins).

Example profile entry:
```json
"audio_remapping": {
  "Zhu-Li": "Joo-Lee",
  "ZeroClaw": "Zero Claw"
}
```

Different profiles can have different mappings for the same word — intentional and by design.

## Behavior

1. Operator or agent calls `send(audio: "Say hello to Zhu-Li")`
2. TMCP applies phonetic map: text becomes `"Say hello to Joo-Lee"` before TTS
3. TTS generates audio from substituted text
4. Caption (if provided) uses original text — NOT the substituted version
5. Substitution is transparent to the caller

## Scope / ACs

- [ ] Phonetic substitution map loaded from profile config at startup; changes require restart (hot-reload is a future nice-to-have, not required for v1)
- [ ] Applied only to `audio` parameter, not `text`/caption
- [ ] Case-insensitive match, longer match wins on overlap
- [ ] Map is additive — new entries do not require code change
- [ ] Log substitutions at debug level (original → replacement)
- [ ] Empty map = no-op (backward compatible)

## Out of scope (v1)

- Per-voice overrides (one map applies to all TTS voices)
- Regex patterns (string literal match only)
- UI for editing the map (manual config edit is fine for now)

## Notes

Operator intent: this is a permanent capability, not a one-off fix. The map should be easy to add to.

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs binary (config load at startup, audio-only, case-insensitive replacement-as-is, longer-match-wins, additive, debug log, empty no-op), scope bounded (no regex, no per-voice, no UI), no blocking open questions, delegation correct (Worker, self-contained in profile/config layer)
- fixed: resolved case-handling ambiguity (replacement as-is), clarified hot-reload as non-required nice-to-have
<!-- overseer-gate: PASS 2026-06-28 -->
