# 20-1936 — tts: set code default timeout to 45s, fix stale comments

## Context

PR #177 changed the TTS synthesis timeout fallback from 60000ms to 30000ms. The operator reviewed this during PR triage and wants 45000ms (45 seconds) as the code default instead. The timeout is configurable via env vars (`TTS_SYNTHESIS_TIMEOUT_PER_100_WORDS_MS`, `TTS_SYNTHESIS_TIMEOUT_MIN_MS`) but the code default should be sensible.

Additionally, the JSDoc comments on `computeTtsSynthesisTimeoutMs` still say "default 60000" — these must be updated to match the new default.

## Changes required

In `src/tts.ts`:

1. Change both `|| 30000` fallbacks to `|| 45000` in `computeTtsSynthesisTimeoutMs()`.
2. Update the JSDoc comments from "default 60000" to "default 45000".

## Acceptance criteria

1. `computeTtsSynthesisTimeoutMs()` uses 45000 as the default when no env var is set.
2. JSDoc comments correctly state "default 45000".
3. All tests pass.

## Source

Operator 2026-05-16: "I kind of want to put it at 45 seconds."
