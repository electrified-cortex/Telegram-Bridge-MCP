transcribe — Transcribe Telegram voice message by file_id.

Voice messages returned by dequeue are pre-transcribed — only call to re-process
(e.g. transcription failed or re-run with updated settings).

## Params
token: session token (required)
file_id: Telegram file_id of voice message (required)
message_id: optional message ID for reaction feedback (optional)
  When provided: adds ✍ reaction during transcription, 🫡 on completion

## Example
action(type: "transcribe", token: 3165424, file_id: "AwACAgIAAxkB...", message_id: 42)
→ { text: "Please check the pipeline status and report back." }

## When to use
- Dequeue returned voice message with no transcript (transcription failed)
- Re-run transcription after TTS config change
- Manual transcription of forwarded voice messages

## Notes
- Dequeue auto-transcribes voice messages on arrival (no manual call needed)
- STT_HOST (optional): OpenAI-compatible Whisper server; omit to use the embedded local ONNX model (zero config)

Related: download, message/get
