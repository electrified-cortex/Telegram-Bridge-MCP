send — Send a message or route to a specialized mode.

Pass `type` to select a mode. Omit all args to list available types.
Default mode (no `type` or `type: "text"`) sends a plain text message.

> **`type` is optional** — omitting it defaults to `"text"`. The `"text"` handler supports text-only, audio-only, and audio+text (voice note with caption) automatically. There is no `"hybrid"` type — pass `audio` and/or `text` without specifying `type` and it works.

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

## Messaging Spectrum

Text-only is the default. Use audio or hybrid only when it adds value.

| Variation | Shape | Use when |
| --- | --- | --- |
| **Text-only (long/structured)** | `text` | Code, diffs, tables, paths — reads badly aloud |
| **Text-only (short)** | `text` (1–3 sentences) | Routine status, terse factual answers |
| **Text + buttons** | `text` + `type: "choice"` or `choose` | Any decision; tap beats typing |
| **Voice + caption + buttons** | `audio + text + choose` | Conversational reply with pending decision |
| **Voice + caption** | `audio + text` | Voice note; caption is topic label, not transcript |
| **Voice + artifact link** | `audio` + `text: "<path>"` | Long factual output; link the file, don't paste |
| **Audio-only** | `audio` | Short ack, morning check-in, pure dialogue |

## Audio Format Rules

When `audio` is present, the content must be:
- **Natural spoken language** — contractions fine; speak like a colleague, not a document.
- **Fluid prose** — flowing sentences; no bullets-pretending-to-be-speech.
- **Minimal punctuation** — commas and periods only. Avoid: em-dashes, semicolons, parentheticals, quotation marks, numbered lists (say "first… second…" instead).
- **No voice-unfriendly content** — code, file paths, tables, diffs go in `text` or a file attachment, never `audio`.

**Don'ts:**
- Don't duplicate audio content in the caption — even paraphrased. Caption must add something audio cannot (topic label, structured payload, link).
- Don't use excessive punctuation in audio — it breaks TTS rhythm.
- Don't send manual reactions on voice messages — the bridge auto-salutes on receipt.
- Don't paste walls of text when voice + brief caption fits better.

## Append Mode

Use `send(type: "append", message_id: <id>, text: "chunk")` to append text to an
existing message. The server reads the current stored text, concatenates the new
chunk after a separator, and edits the message in-place.

O(1) token cost per call — only the new chunk
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

**text** — Reply threading: pass `reply_to: <message_id>`.

**Audio + Text (`"text"` type):** Audio + text supports two patterns: long audio + short label, or short audio + structured text. Never restate audio in the caption. If you need details, call help('audio').

**Async default for audio:** When `audio` is present, the send is async by default — returns `{ message_id_pending, status: "queued" }` immediately; result delivered via `dequeue` as a `send_callback` event. Pass `async: false` to force synchronous execution (blocks until TTS completes, returns real `message_id`). Non-audio sends are always synchronous.

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

Related: send(type: "append"), action(type: "message/edit"), send(type: "notification"), send(type: "file"), send(type: "checklist"), send(type: "progress")
