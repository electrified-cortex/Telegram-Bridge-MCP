# Telegram Bridge MCP — Design Document

**Telegram Bridge MCP** is a Model Context Protocol server that bridges AI assistants to a Telegram bot for two-way communication: messaging, confirmations, status updates, and voice transcription.

---

## Architecture

```text
AI Assistant (MCP Client)
        │  MCP over stdio or Streamable HTTP
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

The server runs as an **MCP server** using either stdio (default, spawned by the MCP host) or Streamable HTTP (when `MCP_PORT` is set, allowing multiple clients to connect over HTTP). It holds a Telegram Bot token (via environment variable) and translates MCP tool calls into Telegram Bot API HTTP requests using **`grammy`** — chosen for its complete, always-up-to-date TypeScript-typed Bot API coverage including all keyboard/button types.

A **background poller** (`poller.ts`) runs a continuous `getUpdates` long-poll loop as soon as the server starts. All incoming updates are fed into an always-on **message store** (`message-store.ts`). Tools consume updates via `dequeue` — they never call the Telegram API directly for polling.

---

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | Yes | Telegram Bot API token from @BotFather |
| `ALLOWED_USER_ID` | Recommended | Numeric Telegram user ID; inbound updates from others are dropped; also the outbound chat target |
| `MCP_PORT` | No | When set, starts a Streamable HTTP server on this port instead of stdio |

Set via environment variable, or a `.env` file (loaded with `dotenv`).

---

## Tool Catalogue

Tools are grouped by abstraction level.

### High-level tools (use these first)

| Tool | Description |
| --- | --- |
| `get_agent_guide` | Returns behavior.md — the behavioral guide for this server. Call at session start. |
| `set_topic` | Sets a default title prepended to all outbound messages as `[Title]`. Useful when multiple MCP host instances share the same Telegram chat — each process labels its messages so you can tell which agent sent what. Pass empty string to clear. Scoped to this server process. |
| `notify` | Sends a titled, severity-coded notification with optional body. Supports silent delivery. |
| `ask` | Sends a question and blocks until the user replies with free text or voice. |
| `choose` | Sends a question with labeled inline keyboard buttons; blocks until a button is pressed or the user replies with text/voice. |
| `confirm` | Sends a Yes/No inline keyboard and blocks until a button is pressed. Returns `{ confirmed: true \| false }`, or `{ timed_out: true }` if the timeout expires without input. |
| `send_choice` | Sends buttons and returns immediately with a `message_id`. The first press auto-locks the keyboard; the callback event appears in `dequeue`. Non-blocking version of `choose`. |
| `send_new_checklist` | Creates or edits a live task checklist message with per-step status indicators. |
| `send_new_progress` | Creates a progress bar message rendered as `▓▓▓▓▓░░░░░ 50%`. Returns `{ message_id }`. |
| `update_progress` | Edits an existing progress bar in-place by `message_id`. All params required each call. |

### Polling & message retrieval

| Tool | Description |
| --- | --- |
| `dequeue` | **Universal update consumption.** Blocks up to `timeout` seconds (default 300 s) when the queue is empty. Returns `{ updates: [...] }` — a compact batch: response lane items (reactions, callbacks) first, then up to one message lane item. Voice messages arrive pre-transcribed. Returns `{ timed_out: true }` when a blocking wait expires, or `{ empty: true }` for instant polls (`timeout: 0`). `pending` is included when more updates are queued. |
| `get_message` | Random-access lookup of a stored message by ID with optional version history. Returns text, caption, file metadata, and edit history. Only call for message IDs already known to this agent session. |

### Messaging

| Tool | Description |
| --- | --- |
| `send_message` | Core send primitive — sends a message with an optional inline keyboard and returns immediately with a `message_id`. For persistent keyboards; button presses arrive via `dequeue`. |
| `edit_message` | Core edit primitive — modifies an existing message by ID. Pass `text`, `keyboard`, or both. Pass `keyboard: null` to remove buttons. |
| `send_text` | Sends a text message. Supports Markdown (default, auto-converted), MarkdownV2, HTML. Messages over 4096 chars are automatically split. |
| `send_text_as_voice` | Synthesizes text to speech and sends it as a voice note. Requires `TTS_HOST` or `OPENAI_API_KEY`. All Markdown is stripped before synthesis. |
| `send_file` | Sends a file (photo, document, video, audio, or voice) by local path, HTTPS URL, or Telegram `file_id`. Type is auto-detected by extension. |
| `append_text` | Delta-appends a chunk to an existing message in-place. O(1) token cost per call. |
| `download_file` | Downloads a received file to local disk by `file_id`. Returns text content for text-based files under 100 KB. |
| `transcribe_voice` | Re-transcribes a voice message by `file_id`. Use when transcription failed or the result needs to be fetched again. |
| `delete_message` | Deletes a message by ID. |
| `pin_message` | Pins or unpins a message. Pass `unpin: true` to unpin; omit `message_id` with `unpin: true` to unpin the most recent. |
| `send_chat_action` | Sends a one-shot action indicator (typing, upload_photo, etc.) that lasts ~5 s. |
| `show_typing` | Idempotent sustained typing indicator — starts or extends a looping interval. Pass `cancel: true` to stop immediately. |

### Visual (animations)

| Tool | Description |
| --- | --- |
| `show_animation` | Starts a cycling placeholder message with configurable frames and interval. Single frame = static placeholder. Auto-cancels on timeout. |
| `cancel_animation` | Stops the active animation. Without `text`: deletes the placeholder. With `text`: edits it into a permanent message. |
| `set_default_animation` | Configures the session's default animation frames or registers named presets for `show_animation`. |

### Interaction primitives

| Tool | Description |
| --- | --- |
| `answer_callback_query` | Dismisses the loading spinner after an inline button press. Must be called within 30 s of receiving the callback. |

### Bot / chat info

| Tool | Description |
| --- | --- |
| `get_me` | Returns basic information about the bot (id, username, capabilities). |
| `get_chat` | Returns information about the configured chat. Requires operator approval via a consent button before any PII is returned. |
| `set_commands` | Registers (or clears) the Telegram slash-command menu for the active chat or globally. Pass `[]` to remove the menu. Commands are automatically cleared on shutdown (SIGTERM, SIGINT, `shutdown`) so stale menu options never linger. |

### Reactions

| Tool | Description |
| --- | --- |
| `set_reaction` | Sets an emoji reaction on a message. Supports semantic aliases (`thinking`, `done`, `salute`, etc.) and raw emoji. |

### Session

| Tool | Description |
| --- | --- |
| `session_start` | Call once at session start. Sends an intro message, checks for pending messages from a previous session, and asks the operator whether to resume or start fresh. Returns `{ sid, pin, sessions_active, action }`. |
| `close_session` | Close the current session. Requires `sid`/`pin` auth. Removes from active list and cleans up per-session queue and ownership entries. |
| `list_sessions` | List all active sessions (SID, name, creation time) and the currently active session. No auth required. |
| `send_direct_message` | Send a direct message to another session (internal only, never appears in Telegram). Requires auth. All active sessions can DM each other. |
| `pass_message` | Pass an ambiguous message to the next session in cascade order. Only available in cascade routing mode. The last session cannot pass. |
| `route_message` | Route an ambiguous message to a specific target session. Only available in governor mode and only callable by the governor session. |
| `dump_session_record` | Sends the conversation timeline as a JSON file to the Telegram chat. Returns `{ message_id, event_count, file_id }`. Caption includes the file ID for crash recovery. Accepts optional `limit` (default 100, max 1000). Call only when the operator explicitly requests session history. |

### Server management

| Tool | Description |
| --- | --- |
| `shutdown` | Exits the process cleanly; the MCP client restarts it automatically to pick up new builds. |

---

## MCP Resources

Five Markdown documents are exposed as MCP resources and via `get_agent_guide`:

| URI | File | Description |
| --- | --- | --- |
| `telegram-bridge-mcp://agent-guide` | `behavior.md` | Behavioral guide: personality, tool conventions, formatting rules |
| `telegram-bridge-mcp://communication-guide` | `communication.md` | Tool selection, commit/push flow, loop rules, and multi-step task patterns |
| `telegram-bridge-mcp://quick-reference` | `.github/instructions/telegram-communication.instructions.md` | Hard rules + tool selection table — compact injected rules card |
| `telegram-bridge-mcp://setup-guide` | `setup.md` | Step-by-step setup guide for new users |
| `telegram-bridge-mcp://formatting-guide` | `formatting.md` | Markdown/MarkdownV2/HTML formatting reference |

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

Pre-send validators run before hitting the API for text length, caption length, and callback data byte size. `send_text` auto-splits texts over 4096 chars rather than rejecting them. All outbound API calls use a `callApi()` wrapper that automatically retries on Telegram 429 rate-limit responses (waits `retry_after` seconds, up to 3 retries). Missing `BOT_TOKEN` at startup causes an immediate fatal exit with a clear message to stderr.

---

## Formatting

All tools that send text default to `parse_mode: "Markdown"`. The server auto-converts standard Markdown syntax to Telegram MarkdownV2 — no manual escaping needed.

Explicit `parse_mode: "MarkdownV2"` and `parse_mode: "HTML"` are also supported for full control.

See `formatting.md` (or the `telegram-bridge-mcp://formatting-guide` resource) for the full reference.

---

## Project Structure

```text
telegram-bridge-mcp/
├── src/
│   ├── index.ts              # Entry point — starts MCP server (stdio or Streamable HTTP), background poller
│   ├── server.ts             # McpServer definition, tool registration, resource registration
│   ├── telegram.ts           # grammy Api wrapper, security enforcement,
│   │                         #   pre-send validators, error classification
│   ├── message-store.ts      # Always-on message store: record, dequeue, waitForEnqueue, getMessage
│   ├── poller.ts             # Background poller: getUpdates loop, auto-transcription
│   ├── animation-state.ts   # Cycling animation state (show_animation / cancel_animation)
│   ├── transcribe.ts         # Local Whisper voice transcription (HuggingFace ONNX)
│   ├── tts.ts                # TTS synthesis → OGG/Opus. Provider auto-selected from env:
│   │                         #   TTS_HOST → any OpenAI-compatible server; OPENAI_API_KEY → OpenAI;
│   │                         #   neither → free local ONNX (HuggingFace transformers)
│   ├── ogg-opus-encoder.ts   # Pure TypeScript OGG/Opus encoder (PCM → OGG container)
│   ├── topic-state.ts        # Per-process topic prefix state (set_topic)
│   ├── typing-state.ts       # Sustained typing indicator loop (show_typing)
│   ├── update-sanitizer.ts   # Strips large/binary fields from updates before returning to agent
│   ├── markdown.ts           # Markdown → MarkdownV2 auto-conversion
│   ├── built-in-commands.ts  # Server-intercepted slash commands (/session, /voice, /routing)
│   ├── shutdown.ts           # SIGTERM/SIGINT handler; clears slash-command menus
│   ├── setup.ts              # pnpm pair wizard — writes .env from live bot pairing
│   └── tools/
│       ├── get_agent_guide.ts
│       ├── notify.ts
│       ├── ask.ts
│       ├── choose.ts
│       ├── confirm.ts
│       ├── send_choice.ts
│       ├── send_new_checklist.ts│       ├── send_new_progress.ts
│       ├── update_progress.ts│       ├── dequeue.ts
│       ├── get_message.ts
│       ├── answer_callback_query.ts
│       ├── send_message.ts
│       ├── edit_message.ts
│       ├── send_text.ts
│       ├── send_text_as_voice.ts
│       ├── send_file.ts
│       ├── append_text.ts
│       ├── delete_message.ts
│       ├── pin_message.ts
│       ├── send_chat_action.ts
│       ├── show_typing.ts
│       ├── show_animation.ts
│       ├── cancel_animation.ts
│       ├── set_default_animation.ts
│       ├── download_file.ts
│       ├── transcribe_voice.ts
│       ├── set_topic.ts
│       ├── set_commands.ts
│       ├── get_me.ts
│       ├── get_chat.ts
│       ├── set_reaction.ts
│       ├── session_start.ts
│       ├── close_session.ts
│       ├── list_sessions.ts
│       ├── send_direct_message.ts
│       ├── pass_message.ts
│       ├── route_message.ts
│       ├── dump_session_record.ts
│       └── shutdown.ts
├── docs/
│   ├── behavior.md               # Agent behavioral guide (also served as MCP resource)
│   ├── communication.md          # Communication patterns (also served as MCP resource)
│   ├── formatting.md             # Formatting reference (also served as MCP resource)
│   ├── setup.md                  # Setup guide (also served as MCP resource)
├── LOOP-PROMPT.md             # Sample loop prompt for MCP agent sessions
├── LICENSE                   # AGPL-3.0
├── package.json
└── tsconfig.json
```

---

## Key Design Decisions

**Single-user by design.** The server is locked to one `ALLOWED_USER_ID` via config, which also serves as the outbound chat target (for private bots, chat.id === user.id). Tools do not accept `chat_id` parameters — the target is resolved transparently. This eliminates an entire class of misdirected-message bugs and simplifies tool signatures.

**Polling over webhooks.** The server uses long-polling (up to 55 s timeout). No public URL, no TLS cert, no webhook registration required. Works out of the box behind NAT and in local development.

**Background poller with message store.** A single background `getUpdates` loop runs continuously (started in `index.ts`) and feeds all updates into an always-on message store (`message-store.ts`). Tools consume from the store via `dequeue` — no tool-level long-polling against the Telegram API. This separates update ingestion from update consumption and enables voice pre-transcription, random-access message lookup, and reliable queuing.

**`dequeue` is the sole update-consumption tool.** It replaces the former `get_update`, `get_updates`, `wait_for_message`, and `wait_for_callback_query` tools. The response lane (reactions, callbacks) drains before the message lane on each call. `pending` tells the agent how many more updates are queued (omitted when 0).

**Structured errors over exceptions.** All Telegram API errors are classified into typed `TelegramErrorCode` values with actionable messages. The assistant can branch on `code` rather than parsing raw error strings.

## Worktree Support

Workers use git worktrees to isolate code changes from the main workspace. Each code-change task gets its own branch and worktree under `.git/.wt/`. The overseer manages the merge and cleanup lifecycle. See `tasks/worktree-workflow.md` for the full process.
