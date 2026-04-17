send — Send a message or route to a specialized mode.

Pass `type` to select a mode. Omit all args to list available types.
Default mode (no `type` or `type: "text"`) sends a plain text message.

## Available Types

| type | Purpose | Key required params |
| --- | --- | --- |
| `text` (default) | Text message, auto-split, Markdown auto-converted | `text` or `audio` |
| `notification` | Formatted alert with severity styling | `title` |
| `file` | Upload a file (photo, document, video, audio, voice) | `file` |
| `choice` | Inline keyboard buttons (non-blocking) | `text`, `options` |
| `dm` | Private message to another session | `target` or `target_sid`, `text` |
| `append` | Append text to an existing message in-place | `message_id`, `text` |
| `animation` | Looping text-frame placeholder (ephemeral) | `preset` or `frames` |
| `checklist` | Create a pinned step-status checklist | `title`, `steps` |
| `progress` | Create a pinned progress bar | `percent` |
| `question` | Interactive prompt (ask / choose / confirm) | sub-type param |

## Append Mode

Use `send(type: "append", message_id: <id>, text: "chunk")` to append text to an
existing message. The server reads the current stored text, concatenates the new
chunk after a separator, and edits the message in-place.

Internally routes to `append_text`. O(1) token cost per call — only the new chunk
is passed; the bridge builds the full accumulated string.

**Pattern:**
1. Send initial message: `send(type: "text", text: "Starting…")` → save returned `message_id`
2. Append updates:       `send(type: "append", message_id: <id>, text: " step 1 done")`
3. Continue appending until complete

**Parameters:**
- `message_id` (required) — ID of the message to append to. Must be a message
  sent or received in the current session (held in the in-memory message store).
- `text` (required) — The new chunk to append.
- `separator` (optional, default `"\n"`) — String inserted between the existing
  text and the new chunk. Pass `""` for no separator, `" "` for inline append.
- `parse_mode` (optional, default `"Markdown"`) — Applied to the full accumulated
  text on each edit. `"Markdown"` is auto-converted to MarkdownV2 before sending.

> **Note:** The returned `length` is the pre-escape character count of the accumulated text. When `parse_mode` is `"Markdown"` (the default), MarkdownV2 escaping adds backslash characters, so the Telegram-visible character count will be higher. Apply a safety margin (e.g. stop appending at `length > 3800`) to avoid unexpected `MESSAGE_TOO_LONG` errors.

**Edge cases:**
- `MESSAGE_NOT_FOUND` — message ID is not in the current session's store.
  Only messages from the current session are tracked; IDs from previous sessions
  or other bots are not available.
- `MESSAGE_NOT_TEXT` — the target message contains non-text content (e.g. voice,
  photo). Append only works on text messages.
- `MESSAGE_TOO_LONG` — the accumulated text would exceed Telegram's 4096-character
  limit. Plan your append sequence to stay within this budget.
- `parse_mode` applies to the **entire accumulated text**, not just the new chunk.
  If earlier chunks used `Markdown` markers, later appends must keep the overall
  text valid for the same parse mode. Mixing parse modes across appends is not
  supported.
- Telegram rate-limits edits to approximately 1 edit/second per message. Rapid
  appends may be throttled; the bridge will surface the API error if this occurs.
- In rare cases Telegram's API returns `true` instead of a message object. The
  bridge handles this gracefully by returning
  `{ message_id: <original_id>, length: <previous_length> }`.
- Passing an empty `text` string when the message already has content will append
  only the separator (e.g. `"existing\n"`). To avoid this, validate that `text`
  is non-empty before calling append.

**Example:**
```
// 1. Create the message
{ message_id } = send(type: "text", token: <token>, text: "Running…")

// 2. Append as steps complete
send(type: "append", token: <token>, message_id, text: "Step 1 done")
send(type: "append", token: <token>, message_id, text: "Step 2 done")
send(type: "append", token: <token>, message_id, text: "All done.")

// Result visible in Telegram:
// Running…
// Step 1 done
// Step 2 done
// All done.
```

**Inline append (no newline):**
```
send(type: "append", token: <token>, message_id, text: "…", separator: " ")
```

## Other Modes (brief)

**text** — Auto-splits messages over 4096 chars. Markdown auto-converted to
MarkdownV2. Pass `audio` for TTS voice note. Both text+audio → caption + voice.
Reply threading: pass `reply_to: <message_id>`.

**Hybrid:** `send(type: "text", text: "...", audio: "...")` → voice note + text caption in one msg.
Use for urgent updates where operator may be away from phone.
Pattern: voice = full detail, caption = TL;DR.
In `type: "text"` mode, buttons can't be added to that same msg — send a
`confirm`/yes-no prompt immediately after if response is needed.
If you need audio + caption + inline buttons in one message, use interactive
modes such as `send(type: "question", choose: [...], audio: "...")`,
`send(type: "choice", options: [...], audio: "...")`, or `confirm`.

**notification** — Formatted block with severity emoji header. Required: `title`.
Optional: `text`, `severity` (info/success/warning/error). Silent by default.

**file** — `file` accepts local path, HTTPS URL, or Telegram `file_id`. Auto-detect
type by extension, or pass `file_type`. Optional `caption`.

**choice** — Non-blocking inline keyboard. Required: `text`, `options` array
`[{ label, value, style? }]`. Use `columns` (default 2) for layout.

**dm** — Routes a private message to another session's queue (operator never sees).
Required: `target` or `target_sid`, `text`.

**animation** — Creates a cycling placeholder. Pass `preset` (name) or `frames`
(string[]). See `help(topic: "animation")` for the full guide.

**checklist** — Creates a pinned step tracker. Required: `title`, `steps` array
`[{ label, status }]`. See `help(topic: "checklist")` for status values.

**progress** — Creates a pinned progress bar. Required: `percent` (0–100).
Optional: `title`, `subtext`, `width` (default 10).

**question** — Interactive prompt, blocks until user responds or timeout. Pass one
of: `ask` (string, free-text reply), `choose` (options array, button select),
`confirm` (string, yes/no). Default `timeout_seconds: 60`.

Related: append_text, edit_message, notify, send_file, send_new_checklist, send_new_progress, ask, choose, confirm
