# 05-790 - Fix transcribe help topic: wrong env var

## Context

`docs/help/transcribe.md:23` tells agents that transcription "Requires TTS provider configured (TTS_HOST or OPENAI_API_KEY)". This is wrong. `TTS_HOST` and `OPENAI_API_KEY` are consumed only by the outbound text-to-speech path (`src/tts.ts`) and the built-in TTS config command. Inbound speech-to-text (`src/transcribe.ts`) reads only `STT_HOST`, and when unset falls back to the embedded local ONNX model requiring no configuration at all.

An agent reading the help topic would incorrectly conclude transcription needs TTS credentials, and may diagnose a transcription failure against the wrong setting.

## Acceptance Criteria

1. `docs/help/transcribe.md` line 23 bullet is replaced with accurate copy naming `STT_HOST` (optional, OpenAI-compatible Whisper server) and the local ONNX fallback (zero-config).
2. No other mention in the same doc tells agents TTS credentials are a transcription prerequisite.
3. Help doc still reads cleanly (no broken formatting, list intact).
4. No code changes. This is a doc-only fix.

## Evidence

- `src/transcribe.ts:113` — only `process.env.STT_HOST` is read in the STT path. No `TTS_HOST` / `OPENAI_API_KEY` references.
- `src/tts.ts:274` and `src/built-in-commands.ts:681` — `TTS_HOST` / `OPENAI_API_KEY` are exclusively TTS (outbound).
- `.env.example` "Voice transcription (optional)" section documents `STT_HOST` for inbound, no mention of `TTS_HOST` there.

## Don'ts

- Do not change `src/transcribe.ts` or any other source file.
- Do not restructure the help doc or change unrelated lines.
- Do not assume the local ONNX model requires setup — it ships embedded.

## Priority

05 — trivial fix, one doc line, but it's actively misleading agents diagnosing transcription problems.

## Delegation

Worker (TMCP). Trivial scope, sub-10-minute job.
