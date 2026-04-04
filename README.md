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
- **Reminders** — scheduled events that fire as synthetic messages after a delay
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

> **Which mode?**
> - **Streamable HTTP** — start one server, connect multiple clients (VS Code, Claude Code, Cursor, etc.) simultaneously. Recommended for most users.
> - **stdio** — no persistent server; each client spawns its own process. Simpler, but only one client at a time.
>
> For full per-client snippets and advanced options, see [`docs/setup.md`](docs/setup.md).

#### Streamable HTTP (recommended)

Run **one** server instance and connect any number of editors, agents, or Claude Code sessions to it. Each client gets its own MCP session with an isolated queue — no `getUpdates` conflicts.

**1. Start the server** (terminal, tmux, startup script, etc.):

```bash
pnpm start -- --http          # HTTP on port 3099 (default)
pnpm start -- --http 4000     # HTTP on port 4000
MCP_PORT=3099 pnpm start      # also works (env var, unchanged)
```

The server listens on `http://127.0.0.1:3099/mcp` using the [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) transport. All config comes from `.env` — no credentials in your editor config.

**2. Point your MCP hosts at it:**

**VS Code** (`.vscode/mcp.json` or user settings):

```json
{
  "servers": {
    "telegram": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3099/mcp"
    }
  }
}
```

**Claude Code** (`.mcp.json` in your project root):

```json
{
  "mcpServers": {
    "telegram": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3099/mcp"
    }
  }
}
```

> Do not add to global `~/.claude.json` — every Claude Code session would connect, generating noise.

**Cursor** (`.cursor/mcp.json` in your project root):

```json
{
  "mcpServers": {
    "telegram": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3099/mcp"
    }
  }
}
```

<details>
<summary><strong>stdio mode</strong> (single-instance fallback)</summary>

If you can't run a persistent server, stdio mode spawns a dedicated process per host. Only one host can connect at a time — multiple instances will fight over `getUpdates`.

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

**Cursor** (`.cursor/mcp.json`):

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

**Launcher bridge** — `dist/launcher.js` auto-starts the HTTP server if none is running, then bridges stdio ↔ HTTP. Use it as a drop-in replacement for `dist/index.js` in any stdio config above. Credentials come from `.env` — no need to set `env` in your editor config:

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/launcher.js"],
      "cwd": "/absolute/path/to/telegram-bridge-mcp"
    }
  }
}
```

**Claude Desktop / Claude Code** (`claude_desktop_config.json` / `.mcp.json`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/launcher.js"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/launcher.js"]
    }
  }
}
```

</details>

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
| `session_start` | Authenticate, returns `token` integer for all subsequent calls |
| `close_session` | Disconnect gracefully |
| `list_sessions` | See all active sessions |
| `rename_session` | Change display name (requires operator approval) |
| `send_direct_message` | DM another session |
| `route_message` | Forward an event to another session |
| `dump_session_record` | Export timeline as JSON |

### Reminders

| Tool | Description |
| --- | --- |
| `set_reminder` | Schedule a reminder event after a delay |
| `cancel_reminder` | Cancel a pending reminder by ID |
| `list_reminders` | List all reminders for the current session |

### Utilities

`get_me` · `get_chat` · `get_agent_guide` · `get_debug_log` · `set_reaction` · `set_commands` · `set_topic` · `set_default_animation` · `set_voice` · `download_file` · `transcribe_voice` · `shutdown`

---

## Multi-Session

Multiple agents can share one bot simultaneously. Each session gets:

- **Identity** — single `token` integer returned by `session_start`, required on every tool call
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

Per-session voice override: use the `set_voice` tool or `/voice` in Telegram.

---

## Security

- **`ALLOWED_USER_ID`** — only this user's messages are processed; everything else is silently dropped
- `chat_id` is never a tool parameter — resolved from `ALLOWED_USER_ID` internally
- Multi-session auth via single `token` integer on every tool call
- `rename_session` requires explicit operator approval via inline keyboard

See `docs/security-model.md` for details.

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
```

> **Pairing first:** Run steps 2–3 on a machine with Node.js to create your `.env` file, or manually create one from `.env.example`. Docker reads it via `--env-file`.

**Streamable HTTP (recommended)** — run as a long-lived service:

```bash
docker run -d --name telegram-mcp \
  --env-file /absolute/path/to/.env \
  -e MCP_PORT=3099 \
  -p 3099:3099 \
  -v telegram-mcp-cache:/home/node/.cache \
  ghcr.io/electricessence/telegram-bridge-mcp:latest
```

Then connect your MCP hosts to `http://127.0.0.1:3099/mcp` (same config as above).

<details>
<summary><strong>stdio mode</strong> (per-host process)</summary>

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

</details>

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

## License

AGPL-3.0-only — see [LICENSE](LICENSE).
