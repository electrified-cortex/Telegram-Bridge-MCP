---
id: 15-0818
title: send — detect stray tool-call markup in audio payload, warn in result
status: draft
priority: 15
origin: observed Curator session 2026-04-24 SID 1 — Opus 4.7 tool-call emission drift caused audio param to contain `</audio>\n<parameter name="text">...` literal; text param missing from call; Telegram rendered audio-only; operator "TMCP should return a warning if the message dropped"
---

# send — detect stray tool-call markup in audio payload, warn in result

## Problem

On 2026-04-24, Curator (Opus 4.7, fresh session) repeatedly produced `send` calls where the `audio` parameter value literally contained the string `...audio_content</audio>\n<parameter name="text">...text_content...` and the `text` parameter key was entirely absent from the call. The failing calls were visible in `log/trace tool=send`:

```
audio: "...I slipped.</audio>\n<parameter name=\"text\">Docs were enough. ...</parameter>",
(no text key)
```

Effect:

- TTS rendered the entire mashed string, audibly reading the tool-call markup plus the intended caption content.
- Telegram received no separate text, so the message rendered as audio-only.
- Operator perceived "double-messaging on audio" and "TMCP dropping the caption," when in fact TMCP faithfully sent what it received.

Dev commits since v7.1 do not modify audio/text handling; the defect is upstream of TMCP (client-side tool-call emission). But TMCP is in the best position to detect and surface it.

## Proposed

In the send handler (audio path), before passing audio to TTS, scan the string for markup patterns that should never appear in a spoken payload:

- `</audio>`
- `<parameter name=` (with or without antml: prefix)
- `</parameter>`
- `</invoke>`, `</function_calls>`, `<invoke name=`

If any match:

1. Strip the markup and everything after the first offending tag from the audio payload before TTS synthesis (send only the clean prefix as voice).
2. Extract any trailing `<parameter name="text">...</parameter>` content from the audio string and promote it to the caption (Telegram text), so the intent is preserved.
3. Return a `warning` field in the send response:

```json
{
  "message_id": 42021,
  "audio": true,
  "warning": {
    "code": "AUDIO_MARKUP_LEAK",
    "message": "Audio payload contained tool-call markup (`</audio>` or `<parameter name=`). Stripped before TTS; recovered caption from trailing `<parameter name=\"text\">` block. Your client may be emitting parameters without the antml:parameter namespace — check hybrid emission on long audio strings."
  }
}
```

This gives the agent an actionable signal on the NEXT call rather than silently succeeding.

## Requirements

- Detect the leak patterns listed above in `audio` when `type === "text"` (hybrid or audio-only).
- Strip the first offending tag and subsequent content from the audio before TTS.
- Recover any `<parameter name="text">...</parameter>` content and use it as caption (overrides / supplements the `text` param if the text param is missing).
- Return a structured `warning` in the success response.
- Log a single `warn`-level line in route category when the leak is detected (for post-hoc diagnostic).

## Acceptance

- [ ] Unit test: audio payload with `</audio>` mid-string → response has `warning.code === "AUDIO_MARKUP_LEAK"`; TTS receives only pre-tag content.
- [ ] Unit test: audio payload with trailing `<parameter name="text">X</parameter>` → caption in outgoing Telegram is `X`; audio is pre-tag content.
- [ ] Unit test: clean audio payload → no warning, no strip.
- [ ] Integration test: replay of captured failing call from 2026-04-24 produces a hybrid message with clean voice + correct caption, plus warning.

## Don'ts

- Don't reject the send — strip and continue. The agent's intent is recoverable; rejection would force a retry and waste tokens.
- Don't add the leak patterns to a user-configurable allowlist. This is an infrastructure-level safety net, not user content.
- Don't emit the warning text via TTS. Warning is in the response envelope only.

## Related

- Curator memory `feedback_hybrid_tool_call_drift` — the agent-side observation of this drift.
- Origin observation in `log/trace` from session 2026-04-24T21:xx (Curator SID 1).
