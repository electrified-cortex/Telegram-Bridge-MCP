# Telegram Bridge MCP

> Two-way Telegram bridge for AI agents — messaging, voice, multi-session, real-time.

![Telegram Bridge MCP](logo.png)

[![CI](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml)
[![Docker](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-telegram--bridge--mcp-blue?logo=docker)](https://github.com/electricessence/Telegram-Bridge-MCP/pkgs/container/telegram-bridge-mcp)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants to Telegram. Send messages, ask questions, receive voice replies, run multiple agent sessions concurrently — all through a single bot.

Works with VS Code Copilot, Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible host.

---

## Highlights

- **Two-way messaging** — text, Markdown, files, voice notes
- **Interactive controls** — buttons, confirmations, checklists, progress bars
- **Voice in, voice out** — automatic transcription (Whisper) and TTS (local or OpenAI)
- **Multi-session** — multiple agents share one bot with per-session queues, identity auth, and message routing
- **Live animations** — cycling status messages while the agent works
- **Slash commands** — dynamic bot menu; commands arrive as structured events
- **No webhooks** — long-polling, no public URL needed

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/electricessence/Telegram-Bridge-MCP.git
cd Telegram-Bridge-MCP
pnpm install && pnpm build
```

Or use the pre-built [Docker image](#docker) — no Node.js required.

### 2. Create a Telegram bot

Message **@BotFather** → `/newbot` → copy the token.

### 3. Pair

```bash
pnpm pair
```

Verifies your token, generates a pairing code, waits for you to send it to the bot, then writes `.env`.

### 4. Configure your MCP host

See `mcp-config.example.json` for a complete reference. The core shape for each host:

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/telegram-bridge-mcp",
      "env": { "BOT_TOKEN": "...", "ALLOWED_USER_ID": "..." }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`) / **Claude Code** (`.mcp.json`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/index.js"],
      "env": { "BOT_TOKEN": "...", "ALLOWED_USER_ID": "..." }
    }
  }
}
```

> Do not add to global `~/.claude.json` — multiple instances will fight over `getUpdates`.

### 5. Start

Paste `LOOP-PROMPT.md` into your AI assistant's chat. It connects, announces itself on Telegram, and waits for instructions.

---

## Tools

### Interaction

| Tool | Description |
| --- | --- |
| `send_text` | Send a formatted message |
| `send_text_as_voice` | TTS voice note |
| `notify` | Notification with severity |
| `ask` | Question → blocks for text/voice reply |
| `choose` | 2–8 buttons → blocks for selection or voice |
| `confirm` | Yes/No prompt with button styles |
| `send_new_checklist` | Live checklist (edits in-place) |
| `send_new_progress` / `update_progress` | Emoji progress bar |
| `show_animation` / `cancel_animation` | Cycling status message |
| `dequeue_update` | Wait for next inbound event |

### Messaging

`send_message` · `send_choice` · `edit_message` · `edit_message_text` · `append_text` · `delete_message` · `pin_message` · `send_file` · `show_typing` · `send_chat_action` · `answer_callback_query` · `get_message` · `get_chat_history`

### Session

| Tool | Description |
| --- | --- |
| `session_start` | Authenticate, get identity `[sid, pin]` |
| `close_session` | Disconnect gracefully |
| `list_sessions` | See all active sessions |
| `rename_session` | Change display name |
| `send_direct_message` | DM another session |
| `route_message` | Forward an event to another session |
| `dump_session_record` | Export timeline as JSON |

### Utilities

`get_me` · `get_chat` · `get_agent_guide` · `get_debug_log` · `set_reaction` · `set_commands` · `set_topic` · `set_default_animation` · `download_file` · `transcribe_voice` · `shutdown`

---

## Multi-Session

Multiple agents can share one bot simultaneously. Each session gets:

- **Identity** — `[sid, pin]` tuple returned by `session_start`, required on every tool call
- **Isolated queue** — per-session message routing, no cross-talk
- **Name tags** — outbound messages are prefixed with the session's color + name (e.g., `🟩 🤖 Worker 1`)
- **Governor model** — first session is primary; others join with operator approval via color-picker keyboard
- **Health monitoring** — unresponsive sessions trigger operator prompts to reroute or promote
- **DMs** — inter-session messaging via `send_direct_message`
- **Graceful teardown** — orphaned events rerouted, callback hooks replaced on close

See `docs/multi-session-protocol.md` for the full routing protocol.

---

## Voice

### Transcription (inbound)

Voice messages are auto-transcribed before delivery. No external API, no ffmpeg.

```env
WHISPER_MODEL=onnx-community/whisper-base   # default
WHISPER_CACHE_DIR=/path/to/cache            # optional
```

### Text-to-Speech (outbound)

`send_text_as_voice` picks a provider automatically:

| Env var | Provider |
| --- | --- |
| `TTS_HOST` | Any OpenAI-compatible `/v1/audio/speech` endpoint |
| `OPENAI_API_KEY` | api.openai.com |
| Neither | Free local ONNX model (zero config) |

**Kokoro** (recommended local TTS) — `docker run -d --name kokoro -p 8880:8880 ghcr.io/hexgrad/kokoro-onnx-server:latest`, then set `TTS_HOST=http://localhost:8880 TTS_FORMAT=ogg TTS_VOICE=af_heart`. 25+ voices — send `/voice` in Telegram to browse and sample.

---

## Security

- **`ALLOWED_USER_ID`** — only this user's messages are processed; everything else is silently dropped
- `chat_id` is never a tool parameter — resolved from `ALLOWED_USER_ID` internally
- Multi-session auth via `[sid, pin]` identity on every tool call
- See `docs/security-model.md` for details

---

## Resources

Five MCP resources available to any client:

| URI | Contents |
| --- | --- |
| `telegram-bridge-mcp://agent-guide` | Behavioral guide |
| `telegram-bridge-mcp://communication-guide` | Communication patterns and loop rules |
| `telegram-bridge-mcp://quick-reference` | Hard rules + tool table (compact) |
| `telegram-bridge-mcp://setup-guide` | Setup walkthrough |
| `telegram-bridge-mcp://formatting-guide` | Markdown/MarkdownV2/HTML reference |

---

## Docker

```text
ghcr.io/electricessence/telegram-bridge-mcp:latest
ghcr.io/electricessence/telegram-bridge-mcp:4.0.0
```

Replace the `node` command in any host config above with:

```json
{
  "command": "docker",
  "args": [
    "run", "--rm", "-i",
    "--env-file", "/absolute/path/to/.env",
    "-v", "telegram-mcp-cache:/home/node/.cache",
    "ghcr.io/electricessence/telegram-bridge-mcp:latest"
  ]
}
```

The cache volume persists Whisper/TTS model weights across restarts.

Images are signed with [Cosign](https://docs.sigstore.dev/cosign/overview/) (keyless, GitHub OIDC) and include SBOM + provenance attestations.

---

## Development

```bash
pnpm build          # Compile TypeScript
pnpm dev            # Watch mode
pnpm test           # Run tests
pnpm coverage       # Coverage report
pnpm pair           # Re-run pairing wizard
```

---

## Roadmap

See [`tasks/0-backlog/`](tasks/0-backlog/) and [`tasks/1-draft/`](tasks/1-draft/).

## License

AGPL-3.0-only — see [LICENSE](LICENSE).
