# Nudge agents to set up Kokoro when using fallback TTS

**Type:** Feature / UX improvement
**Priority:** 320 (Low — nice-to-have)
**Source:** Operator feedback (2026-03-19)

## Problem

When `TTS_HOST` is not configured, `send_text_as_voice` falls back to Edge TTS which produces robotic, single-voice output. Agents using it don't know a better option exists.

## Proposed Solution

When the agent calls `send_text_as_voice` and the server uses the Edge TTS fallback (no `TTS_HOST` configured), include a one-time service message or hint in the tool response:

```
hint: "You're using the built-in Edge TTS fallback. For higher-quality, multi-voice TTS, ask the operator about setting up Kokoro (see README § Kokoro Quick Start)."
```

This should only fire once per session — not on every TTS call. A simple flag (`_kokoroHintSent`) would suffice.

The agent sees the hint, and can then proactively say to the user: "Hey, would you like me to help set up Kokoro for better voice quality?"

## Code Path

- `src/tts.ts` — the fallback path when `TTS_HOST` is not set
- Or in the `send_text_as_voice` tool handler — check if the TTS response came from Edge and add a hint field

## Notes

- One-time per session, not spammy
- Could also be a `service_message` event injected into the session queue
- The README already has a "Kokoro Quick Start" section — the hint should reference it
