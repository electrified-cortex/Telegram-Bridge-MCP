# Telegram Bridge MCP

> Unblock your agent workflow through Telegram

![Telegram Bridge MCP](logo.png)

A [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants to a Telegram bot — enabling two-way messaging, interactive confirmations, live status updates, and automatic voice transcription.

Works with any MCP-compatible AI host: VS Code Copilot, Claude Desktop, and others.

> [!NOTE]
> **Pre-release:** This project is functional but has not yet been widely tested in production. Expect rough edges and possible breaking changes.

---

## What it does

Once configured, your AI assistant can:

- **Send messages** to your Telegram chat — plain text, formatted Markdown, photos
- **Ask questions** and wait for your reply — as free text or button choices
- **Post live status updates** — an in-place checklist that updates as tasks progress
- **React to messages** — emoji reactions instead of noise text
- **Transcribe voice messages** — speak your reply; it arrives as text
- **Send and receive files** — send documents/photos from disk or URL; receive any file type and download on demand
- **Receive all of this in real time** — long-polling, no webhooks, no public URL needed

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **pnpm** — install once via: `npm install -g pnpm`

If you prefer `npm`, you can substitute all `pnpm` commands with their `npm` equivalents (`npm install`, `npm run build`, etc.). The project works with either.

Or use the pre-built **Docker image** — no Node.js or pnpm required (see [Docker](#docker) below).

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/electricessence/Telegram-Bridge-MCP.git
cd Telegram-Bridge-MCP
pnpm install
pnpm build
```

### 2. Create a Telegram bot

Open Telegram, message **@BotFather**, and run `/newbot`. Copy the token it gives you.

### 3. Pair the bot to your account

```bash
pnpm pair
```

This interactive wizard:

1. Verifies your bot token
2. Generates a one-time pairing code
3. Waits for you to send that code to your bot in Telegram
4. Captures your user ID and chat ID
5. Writes everything to `.env`

### 4. Configure your MCP host

**VS Code** — add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/telegram-bridge-mcp",
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN",
        "ALLOWED_USER_ID": "YOUR_USER_ID",
        "ALLOWED_CHAT_ID": "YOUR_CHAT_ID"
      }
    }
  }
}
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/index.js"],
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN",
        "ALLOWED_USER_ID": "YOUR_USER_ID",
        "ALLOWED_CHAT_ID": "YOUR_CHAT_ID"
      }
    }
  }
}
```

### 5. Start a session

Paste the contents of `LOOP-PROMPT.md` into your AI assistant's chat. It will connect, announce itself over Telegram, and wait for your instructions.

---

## Tools

### High-level (use these 99% of the time)

| Tool | What it does |
| ------ | ------------- |
| `get_agent_guide` | Loads the behavioral guide — call this at session start |
| `set_topic` | Sets a default title prepended to all outbound messages as `[Title]` — e.g. `[Refactor Agent]`. Useful when multiple VS Code instances share one Telegram chat so you can tell which agent sent what. Pass empty string to clear. |
| `notify` | Silent or audible notification with title, body, and severity |
| `ask` | Sends a question; blocks until you reply with text or voice |
| `choose` | Sends a question with 2–8 labeled buttons; blocks until you tap one or type/speak a reply. Supports per-button color (`success`/`primary`/`danger`). Multiple calls chain naturally for questionnaires. |
| `send_confirmation` | Yes/No prompt; blocks until confirmed or denied. Button colors are customizable (`yes_style`/`no_style`). |
| `update_status` | Live in-place checklist — updates as steps complete |

### Messaging

`send_message` · `edit_message_text` · `forward_message` · `delete_message` · `pin_message` · `unpin_message` · `send_chat_action` · `show_typing` · `cancel_typing`

### Files

`send_document` · `send_photo` · `send_video` · `send_audio` · `send_voice` · `download_file` · `transcribe_voice`

### Interaction primitives

`wait_for_message` · `wait_for_callback_query` · `answer_callback_query`

### Info & utilities

`get_me` · `get_chat` · `set_commands` · `set_reaction` · `get_updates` · `restart_server`

`set_commands` — registers (or clears) the bot's slash-command menu in the active chat. Pass `[{command, description}, ...]` to show commands in Telegram's autocomplete; pass `[]` to remove the menu.

---

## Agent Instruction Files

Pre-built instruction files are included for common agent hosts:

| File | Host | How it works |
| --- | --- | --- |
| `.github/copilot-instructions.md` | VS Code Copilot / GitHub Copilot | Auto-injected into every session |
| `.github/instructions/telegram-communication.instructions.md` | VS Code Copilot (`applyTo: "**"`) | Auto-injected communication rules |
| `CLAUDE.md` | Claude Code | Auto-read at session start |
| `COMMUNICATION.md` | Any agent | Read explicitly or via MCP resource |

---

## Resources

Three guides are available as MCP resources — any MCP client can read them directly:

| Resource URI | Contents |
| --- | --- |
| `telegram-bridge-mcp://agent-guide` | Behavioral guide for AI assistants |
| `telegram-bridge-mcp://communication-guide` | Telegram communication patterns, tool selection, and loop rules |
| `telegram-bridge-mcp://quick-reference` | Hard rules + tool selection table — compact injected rules card |
| `telegram-bridge-mcp://setup-guide` | Full bot setup walkthrough |
| `telegram-bridge-mcp://formatting-guide` | Markdown/MarkdownV2/HTML reference |

---

## Security

The server enforces a strict two-layer security model:

- **`ALLOWED_USER_ID`** — Inbound updates from any other user are silently discarded before the assistant ever sees them. Prevents message injection.
- **`ALLOWED_CHAT_ID`** — Outbound tool calls to any other chat are rejected immediately. Prevents misdirected messages.

The server is designed for **single-user, single-chat** use — `chat_id` is never a tool parameter; it is resolved from config transparently.

See `SETUP.md` for the full security model and threat analysis.

---

## Voice Transcription

All message-receiving tools (`wait_for_message`, `ask`, `choose`, `get_updates`) automatically transcribe voice messages using a local [Whisper](https://github.com/openai/whisper) model via `@huggingface/transformers` (ONNX Runtime). Voice responses also include a `file_id` so the agent can call `transcribe_voice` to re-transcribe if needed.

- No external API calls
- No ffmpeg required
- Model weights are downloaded once on first use and cached locally

Configure via environment variables:

```env
WHISPER_MODEL=onnx-community/whisper-base   # default
WHISPER_CACHE_DIR=/path/to/cache            # optional
```

---

## Voice Output (TTS)

`send_message` with `voice: true` delivers spoken voice notes via TTS.

Provider is selected automatically from env vars:

| Env var set | Provider |
|---|---|
| `TTS_HOST` | Any OpenAI-compatible `/v1/audio/speech` server (Chatterbox, Kokoro, etc.) |
| `OPENAI_API_KEY` (no `TTS_HOST`) | api.openai.com |
| Neither | Free local ONNX model (zero config, downloads on first use) |

```dotenv
# Local TTS server
TTS_HOST=http://your-tts-server
TTS_MODEL=chatterbox   # optional — sent only if set
TTS_VOICE=default      # optional — sent only if set
```

```dotenv
# OpenAI
OPENAI_API_KEY=sk-...
TTS_MODEL=tts-1-hd     # default: tts-1
TTS_VOICE=onyx         # default: alloy
```

If a voice note appears but has no audible audio, check the `duration` field in the tool result — should be non-zero.

---

## Development

```bash
pnpm build          # Compile TypeScript
pnpm dev            # Watch mode
pnpm test           # Run tests
pnpm coverage       # Test coverage report
pnpm pair           # Re-run pairing wizard
```

---

## Docker

A pre-built image is published to the GitHub Container Registry on every push to `master` and on every version tag:

```
ghcr.io/electricessence/telegram-bridge-mcp:latest
ghcr.io/electricessence/telegram-bridge-mcp:1.7.9
```

Create a `.env` file with your credentials (see `.env.example`), then configure your MCP host to use Docker instead of Node:

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "telegram": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--env-file", "/absolute/path/to/.env",
        "-v", "telegram-mcp-cache:/root/.cache",
        "ghcr.io/electricessence/telegram-bridge-mcp:latest"
      ]
    }
  }
}
```

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--env-file", "/absolute/path/to/.env",
        "-v", "telegram-mcp-cache:/root/.cache",
        "ghcr.io/electricessence/telegram-bridge-mcp:latest"
      ]
    }
  }
}
```

The `-v telegram-mcp-cache:/root/.cache` volume persists downloaded Whisper/TTS model weights across container restarts.

---

## License

MIT — see [LICENSE](LICENSE).
