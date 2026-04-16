append_text — Append text to an existing message in-place.

Reads the current text from the in-memory message store, concatenates the new
chunk after a separator, and calls `editMessageText` with the full accumulated
string. O(1) token cost per call — the agent sends only the new chunk.

Prefer `send(type: "append", ...)` when calling through the `send` router.
Use `append_text` directly for maximum clarity in tooling that supports it.

## Params

token: session token (required)
message_id: ID of the message to append to (required, integer ≥ 1)
text: new chunk to append (required)
separator: string inserted between existing text and new chunk (default: "\n")
parse_mode: "Markdown" (default) | "HTML" | "MarkdownV2"
  Applied to the full accumulated text on each edit.
  "Markdown" is auto-converted to MarkdownV2 before sending.

## Returns

{ message_id: number, length: number }
  message_id — edited message ID (same as input unless Telegram returned boolean)
  length — total character count of the accumulated text after this append

> **Note:** The returned `length` is the pre-escape character count of the accumulated text. When `parse_mode` is `"Markdown"` (the default), MarkdownV2 escaping adds backslash characters, so the Telegram-visible character count will be higher. Apply a safety margin (e.g. stop appending at `length > 3800`) to avoid unexpected `MESSAGE_TOO_LONG` errors.

## Error codes

MESSAGE_NOT_FOUND — message_id is not in the current session store.
  Only messages from the current session (sent or received after session_start)
  are tracked. Previous sessions, other bots, and messages predating the session
  are not available.

MESSAGE_NOT_TEXT — the target message contains non-text content (voice, photo, etc).
  append_text only supports text messages. Use edit_message for keyboard edits.

MESSAGE_TOO_LONG — the accumulated text would exceed Telegram's 4096-character
  limit. Monitor the returned `length` and stop appending before reaching the cap.

## Edge cases

- **Empty current text:** If the stored message has no text (or text is an empty
  string), the separator is omitted and the new chunk becomes the full text.

- **parse_mode scope:** `parse_mode` is applied to the *entire accumulated text*,
  not just the new chunk. Keep Markdown consistent across all appends. Switching
  parse_mode mid-sequence is not supported.

- **Telegram rate limit:** Telegram allows approximately 1 edit per second per
  message. Rapid successive appends will be throttled by the API. Space calls out
  or batch content before appending if throughput is critical.

- **Boolean response fallback:** In rare cases Telegram's API returns `true`
  instead of a message object. The bridge handles this gracefully by returning
  `{ message_id: <original_id>, length: <previous_length> }`.

- **Empty text chunk:** Passing an empty `text` string when the message already
  has content will append only the separator (e.g. `"existing\n"`). To avoid
  this, validate that `text` is non-empty before calling append.

- **Markdown partial mode:** `resolveParseMode` with `"Markdown"` passes through
  `markdownToV2` in partial mode, which handles unclosed code fences gracefully.
  However, mismatched formatting markers (e.g. an unclosed `*bold*`) in the
  accumulated text may cause Telegram to reject the edit with a parse error.

## Examples

Create and progressively update a message:
```
// 1. Send initial message
{ message_id } = send(type: "text", token: <token>, text: "Running checks…")

// 2. Append results as they complete (default newline separator)
append_text(token: <token>, message_id, text: "✅ Lint passed")
append_text(token: <token>, message_id, text: "✅ Tests passed")
append_text(token: <token>, message_id, text: "✅ Build complete")

// Final message text visible in Telegram:
// Running checks…
// ✅ Lint passed
// ✅ Tests passed
// ✅ Build complete
```

Inline append (no newline):
```
append_text(token: <token>, message_id, text: " (3 warnings)", separator: "")
```

Custom separator:
```
append_text(token: <token>, message_id, text: "item", separator: "\n• ")
```

Related: send (type: "append"), edit_message, send_new_checklist, send_new_progress
