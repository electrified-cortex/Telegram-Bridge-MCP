# Telegram Bridge MCP — Design Document

**Telegram Bridge MCP** is a Model Context Protocol server that bridges AI assistants to a Telegram bot for two-way communication: messaging, confirmations, status updates, and voice transcription.

---

## Architecture

```text
AI Assistant (MCP Client)
        │  MCP over stdio
        ▼
┌──────────────────────────┐
│  Telegram Bridge MCP     │  (Node.js / TypeScript)
│  @modelcontextprotocol/  │
│           sdk            │
└────────────┬─────────────┘
         │  HTTPS REST
         ▼
  Telegram Bot API
  api.telegram.org/bot<token>/...
```

The server runs as a **stdio MCP server**, spawned by the MCP host. It holds a Telegram Bot token (via environment variable) and translates MCP tool calls into Telegram Bot API HTTP requests using **`grammy`** — chosen for its complete, always-up-to-date TypeScript-typed Bot API coverage including all keyboard/button types.

Polling is supported as a first-class pattern: the server maintains a persistent `offset` (last seen `update_id + 1`) in memory across calls, so repeated `get_updates` calls naturally advance the queue without re-delivering old messages.

---

## Configuration

| Variable           | Required    | Description                                                       |
|--------------------|-------------|-------------------------------------------------------------------|
| `BOT_TOKEN`        | Yes         | Telegram Bot API token from @BotFather                            |
| `ALLOWED_USER_ID`  | Recommended | Numeric Telegram user ID; inbound updates from others are dropped |
| `ALLOWED_CHAT_ID`  | Recommended | Chat ID; outbound to other chats and inbound from them rejected   |

Set via environment variable, or a `.env` file (loaded with `dotenv`).

---

## Tool Catalogue

Tools are grouped by abstraction level.

### High-level tools (use these first)

| Tool | Description |
| --- | --- |
| `get_agent_guide` | Returns BEHAVIOR.md — the behavioral guide for this server. Call at session start. |
| `set_topic` | Sets a default title prepended to all outbound messages as `[Title]`. Useful when multiple VS Code windows share the same Telegram chat — each process labels its messages so you can tell which agent sent what. Pass empty string to clear. Scoped to this server process. |
| `notify` | Sends a titled, severity-coded notification with optional body. Supports silent delivery. |
| `ask` | Sends a question and blocks until the user replies with free text. |
| `choose` | Sends a question with labeled inline keyboard buttons; blocks until a button is pressed. |
| `send_confirmation` | Sends a Yes/No inline keyboard and blocks until a button is pressed. Returns `{ confirmed: true | false }`, or `{ timed_out: true }` if the timeout expires without input. |
| `send_temp_message` | Sends a temporary placeholder (e.g. "Thinking…") that is automatically deleted when the next outbound tool fires, or after the TTL. |
| `update_status` | Creates or edits a live task checklist message with per-step status indicators. |

### Interaction primitives

| Tool | Description |
| --- | --- |
| `wait_for_message` | Long-polls until a text or voice message is received. Transcribes voice automatically. |
| `wait_for_callback_query` | Long-polls until an inline button is pressed on a specific message. |
| `answer_callback_query` | Dismisses the loading spinner after a button press. Required after `wait_for_callback_query`. |

### Messaging

| Tool | Description |
| --- | --- |
| `send_message` | Sends a text message. Supports Markdown, MarkdownV2, HTML. Messages over 4096 chars are automatically split into sequential chunks. Set `voice: true` (or configure `TTS_HOST`/`OPENAI_API_KEY`) to send as a spoken voice note via TTS instead. |
| `edit_message_text` | Edits the text of a previously sent message. |
| `send_photo` | Sends a photo by public URL or Telegram `file_id`. |
| `send_document` | Sends a file by local path, public URL, or Telegram `file_id`. |
| `send_video` | Sends a video by local path, public URL, or Telegram `file_id`. |
| `send_audio` | Sends an audio track by local path, public URL, or Telegram `file_id`. Shown as a playable track with title/performer. |
| `send_voice` | Sends a voice note (OGG/Opus) by local path, public URL, or Telegram `file_id`. Displayed with waveform playback. |
| `download_file` | Downloads a received file to local disk by `file_id`. Returns text content for text-based files under 100 KB. |
| `transcribe_voice` | Re-transcribes a voice message by `file_id`. Use when the update was consumed before transcription was read, or if transcription failed previously. |
| `forward_message` | Forwards a message from another chat into the configured chat. |
| `delete_message` | Deletes a message by ID. |
| `pin_message` | Pins a message in the chat. |
| `unpin_message` | Unpins a message in the chat. |
| `send_chat_action` | Sends a one-shot action indicator (typing, upload_photo, etc.) that lasts ~5 s. |
| `show_typing` | Idempotent sustained typing indicator — starts or extends a 4 s interval loop. |
| `cancel_typing` | Explicitly cancels the active typing indicator. |

### Bot / chat info

| Tool | Description |
| --- | --- |
| `get_me` | Returns basic information about the bot (id, username, capabilities). |
| `get_chat` | Returns information about the configured chat. |
| `set_commands` | Registers (or clears) the Telegram slash-command menu for the active chat or globally. Pass `[]` to remove the menu. Useful for surfacing escape-hatch commands like `/cancel` during long-running tasks. |

### Reactions

| Tool | Description |
| --- | --- |
| `set_reaction` | Sets an emoji reaction on a message. |

### Polling

| Tool | Description |
| --- | --- |
| `get_update` | **Default polling tool.** Returns the next available update(s) from the buffer. Optional `update_id` to jump to a specific update; `from_update_id` to start from a known point. Filter by sender: `"all"` (default), `"user"`, `"bot"`, or specific user ID (number). Always returns `remaining` — call again if > 0 before blocking. |
| `get_prior_update` | Navigate backwards through update history. `offset` controls how many updates back (default 1 = most recent). Same filter options as `get_update`. Returns `update_id`, full update content, and `available_before` count. Useful for agents recovering lost context. |
| `get_updates` | Bulk poll for all pending updates — or replay from a known point if `from_update_id` is set. Use only when prepared to iterate and respond to every returned update. No `remaining` signal. Supports same filters. |

### Server management

| Tool | Description |
| --- | --- |
| `restart_server` | Exits the process cleanly; VS Code restarts it automatically to pick up new builds. |

---

## MCP Resources

Five Markdown documents are exposed as MCP resources and via `get_agent_guide`:

| URI | File | Description |
| --- | --- | --- |
| `telegram-bridge-mcp://agent-guide` | `BEHAVIOR.md` | Behavioral guide: personality, tool conventions, formatting rules |
| `telegram-bridge-mcp://communication-guide` | `COMMUNICATION.md` | Tool selection, commit/push flow, loop rules, and multi-step task patterns |
| `telegram-bridge-mcp://quick-reference` | `.github/instructions/telegram-communication.instructions.md` | Hard rules + tool selection table — compact injected rules card |
| `telegram-bridge-mcp://setup-guide` | `SETUP.md` | Step-by-step setup guide for new users |
| `telegram-bridge-mcp://formatting-guide` | `FORMATTING.md` | Markdown/MarkdownV2/HTML formatting reference |

---

## Error Handling

All Telegram API errors are caught and returned as structured MCP tool errors:

```ts
{
  code: TelegramErrorCode,   // e.g. "MESSAGE_TOO_LONG", "RATE_LIMITED"
  message: string,           // Human-readable description with remediation hint
  retry_after?: number,      // Seconds to wait (RATE_LIMITED only)
  raw?: string               // Raw Telegram error description for debugging
}
```

Pre-send validators run before hitting the API for text length, caption length, and callback data byte size. `send_message` auto-splits texts over 4096 chars rather than rejecting them. All outbound API calls use a `callApi()` wrapper that automatically retries on Telegram 429 rate-limit responses (waits `retry_after` seconds, up to 3 retries). Missing `BOT_TOKEN` at startup causes an immediate fatal exit with a clear message to stderr.

---

## Formatting

All tools that send text default to `parse_mode: "Markdown"`. The server auto-converts standard Markdown syntax to Telegram MarkdownV2 — no manual escaping needed.

Explicit `parse_mode: "MarkdownV2"` and `parse_mode: "HTML"` are also supported for full control.

See `FORMATTING.md` (or the `telegram-bridge-mcp://formatting-guide` resource) for the full reference.

---

## Project Structure

```text
telegram-bridge-mcp/
├── src/
│   ├── index.ts              # Entry point — starts MCP server over stdio
│   ├── server.ts             # McpServer definition, tool registration, resource registration
│   ├── telegram.ts           # grammy Api wrapper, security enforcement, offset state,
│   │                         #   pre-send validators, error classification, pollUntil helper
│   ├── temp-message.ts       # Pending temp message state (send_temp_message)
│   ├── transcribe.ts         # Local Whisper voice transcription (HuggingFace ONNX)
│   ├── tts.ts                # TTS synthesis → OGG/Opus. Provider auto-selected from env:
│   │                         #   TTS_HOST → any OpenAI-compatible server; OPENAI_API_KEY → OpenAI;
│   │                         #   neither → free local ONNX (HuggingFace transformers)
│   ├── ogg-opus-encoder.ts   # Pure TypeScript OGG/Opus encoder (PCM → OGG container)
│   ├── topic-state.ts        # Per-process topic prefix state (set_topic)
│   ├── typing-state.ts       # Sustained typing indicator loop (show_typing / cancel_typing)
│   ├── update-buffer.ts      # In-memory buffer for updates received during long-poll waits
│   ├── update-sanitizer.ts   # Strips large/binary fields from updates before returning to agent
│   ├── markdown.ts           # Markdown → MarkdownV2 auto-conversion
│   ├── setup.ts              # pnpm pair wizard — writes .env from live bot pairing
│   └── tools/
│       ├── get_agent_guide.ts
│       ├── notify.ts
│       ├── ask.ts
│       ├── choose.ts
│       ├── send_confirmation.ts
│       ├── update_status.ts
│       ├── wait_for_message.ts
│       ├── wait_for_callback_query.ts
│       ├── answer_callback_query.ts
│       ├── send_message.ts
│       ├── send_message_draft.ts
│       ├── send_temp_message.ts
│       ├── edit_message_text.ts
│       ├── send_photo.ts
│       ├── send_video.ts
│       ├── send_audio.ts
│       ├── send_voice.ts
│       ├── forward_message.ts
│       ├── delete_message.ts
│       ├── pin_message.ts
│       ├── unpin_message.ts
│       ├── send_chat_action.ts
│       ├── show_typing.ts
│       ├── cancel_typing.ts
│       ├── send_document.ts
│       ├── download_file.ts
│       ├── transcribe_voice.ts
│       ├── set_topic.ts
│       ├── set_commands.ts
│       ├── get_me.ts
│       ├── get_chat.ts
│       ├── set_reaction.ts
│       ├── get_update.ts
│       ├── get_prior_update.ts
│       ├── get_updates.ts
│       └── restart_server.ts
├── BEHAVIOR.md               # Agent behavioral guide (also served as MCP resource)
├── COMMUNICATION.md          # Communication patterns (also served as MCP resource)
├── FORMATTING.md             # Formatting reference (also served as MCP resource)
├── SETUP.md                  # Setup guide (also served as MCP resource)
├── LOOP-PROMPT.md            # Sample loop prompt for VS Code Copilot agent sessions
├── LICENSE                   # MIT
├── package.json
└── tsconfig.json
```

---

## Key Design Decisions

**Single-chat, single-user by design.** The server is locked to one `ALLOWED_CHAT_ID` and one `ALLOWED_USER_ID` via config. Tools do not accept `chat_id` parameters — the target is resolved transparently from config. This eliminates an entire class of misdirected-message bugs and simplifies tool signatures.

**Polling over webhooks.** The server uses long-polling (up to 55 s timeout). No public URL, no TLS cert, no webhook registration required. Works out of the box behind NAT and in local development.

**Persistent offset in memory.** The `_offset` variable in `telegram.ts` persists across tool calls for the lifetime of the process, so `get_updates` and `wait_for_*` tools never re-deliver the same message.

**Voice transcription is transparent.** `wait_for_message`, `ask`, `choose`, and `get_updates` all detect voice messages and transcribe them automatically using a local Whisper model. The result is returned as `{ text, voice: true }` — callers do not need to handle voice separately.

**Structured errors over exceptions.** All Telegram API errors are classified into typed `TelegramErrorCode` values with actionable messages. The assistant can branch on `code` rather than parsing raw error strings.
