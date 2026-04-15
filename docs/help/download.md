download — Download file from Telegram by file_id.

Saves to local temp directory. Returns local path, filename, MIME type, file size.
For text files under 100 KB, also returns file contents as `text`.
Only call after user has chosen action requiring the file — no speculative downloads.

## Params
token: session token (required)
file_id: Telegram file_id from message event (required)
  Source: document.file_id, voice.file_id from dequeue events
file_name: suggested filename for folder naming and text detection (optional)
mime_type: MIME type hint from message for text content detection (optional)

## Example
action(type: "download", token: 3165424,
  file_id: "BQACAgIAAxkB...",
  file_name: "script.py",
  mime_type: "text/x-python")
→ {
  local_path: "/tmp/telegram-bridge-mcp/1234567890_script.py",
  file_name: "script.py",
  mime_type: "text/x-python",
  file_size: 2048,
  text: "#!/usr/bin/env python3\n..."
}

## Text file detection
Automatic for: .txt .md .csv .log .yaml .json .ts .js .py .rs .go .sh and more.
Max inline text: 100 KB. Binary files: local_path only.

## Notes
- Requires BOT_TOKEN env var
- Max file size: 20 MB (Telegram limit)
- Temp files saved with mode 0o600 (owner-only)

Related: transcribe, message/get