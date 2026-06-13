# 012 — Audit Voice & TTS Documentation

**Priority:** 30  
**Status:** Queued

## Goal

Ensure voice/TTS documentation is clear, complete, and accurately reflects current capabilities. Kokoro should be clearly documented as the current best out-of-the-box TTS option.

## Scope

1. Review `docs/` for voice/TTS coverage — `setup.md`, `customization.md`, `behavior.md`.
2. Ensure Kokoro is prominently documented as the recommended TTS provider.
3. Document `set_voice` per-session override feature.
4. Document voice transcription flow (receive voice → transcribe → deliver text).
5. Ensure `send_text_as_voice` voice resolution chain is clear: explicit param → session override → global default → provider default.
6. Check for stale references to old TTS providers or configurations.

## Acceptance Criteria

- Voice/TTS section in docs is clear and current.
- Kokoro is recommended with setup instructions.
- `set_voice` documented with available voices.
- Voice transcription documented.
