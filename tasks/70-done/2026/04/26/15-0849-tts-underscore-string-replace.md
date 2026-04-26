---
id: 15-0849-tts-underscore-string-replace
title: TTS — auto-replace underscores in voice content so words pronounce
priority: 15
status: queued
type: feature
delegation: worker
repo: TMCP
---

# TTS — auto-replace ALL_CAPS_WITH_UNDERSCORES in voice content

## Problem

When voice messages are synthesized via TTS, **ALL-CAPS-with-underscores** identifiers (e.g. `SESSION_JOINED`, `PASS_WITH_FINDINGS`, `MD_FAIL`) get spelled out letter-by-letter or drop syllables — pronunciation breaks. Result: spoken audio loses information.

Mixed-case or lower-case-with-underscores (e.g. `session_joined`, `behavior_nudge_first_message`) generally pronounce acceptably and are OUT OF SCOPE for this transformation.

Operator-flagged 2026-04-26 PM. Scope clarified: ALL CAPS + UNDERSCORES only.

## Expected behavior

Before sending audio content to the TTS engine, detect ALL-CAPS-with-underscores tokens (regex roughly: `\b[A-Z][A-Z0-9_]*[A-Z0-9]\b` requiring at least one underscore inside the all-caps word) and transform:

- Replace underscores with spaces, AND
- Lowercase the result, AND
- Wrap the resulting phrase in quotes so TTS reads it as a unit.

Examples:

- `SESSION_JOINED` → `"session joined"`
- `PASS_WITH_FINDINGS` → `"pass with findings"`
- `MD_FAIL` → `"md fail"`
- `session_joined` (lowercase) → leave alone, OUT OF SCOPE
- `behavior_nudge_first_message` → leave alone, OUT OF SCOPE

## Acceptance

- TTS preprocessor matches ALL-CAPS-with-underscores tokens only; does not touch lower-case or mixed-case.
- Transformation: underscores → spaces, lowercase the result.
- Original text content (caption / hybrid text payload) is NOT transformed.
- Test cases verified for each example above.
- Toggle to disable if TTS misbehaves on edge cases.

## Don'ts

- Don't transform lower-case identifiers — they pronounce fine.
- Don't transform URL-style strings (e.g. `https://example.com/my_path`).
- Don't transform the text caption / hybrid text payload.
- Don't strip other punctuation (em-dashes, hyphens already work).

## Notes

- ALL_CAPS identifiers come up in service messages (e.g. error codes, verdict enums like `PASS_WITH_FINDINGS`), report verdicts read aloud, and any constant-style identifier surfaced in audio.
- Filed by Curator on operator's voice direction 2026-04-26 PM, then narrowed per operator clarification same day.

## Source

Operator directive 2026-04-26 PM.

## Completion

- **Branch:** `15-0849`
- **Commit:** `b1a9edc`
- **Files changed:** `src/tts.ts`, `src/tts.test.ts`
- **Summary:** Added `normalizeCapsForTts()` export and `RE_ALL_CAPS_UNDERSCORE` regex. Integrated into `stripForTts` as a three-step pipeline: MCP escapes + fenced/inline code strip → normalization → HTML + remaining Markdown strip. Toggle via `TTS_CAPS_NORMALIZE=0|false|no|off`. 71 tests pass (up from 64).
