# Telegram Bridge MCP

> Unblock your agent workflow through Telegram

![Telegram Bridge MCP](logo.png)

[![CI](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml)
[![Docker](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-telegram--bridge--mcp-blue?logo=docker)](https://github.com/electricessence/Telegram-Bridge-MCP/pkgs/container/telegram-bridge-mcp)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants to a Telegram bot — enabling two-way messaging, interactive confirmations, live status updates, voice transcription, and text-to-speech replies.

Works with any MCP-compatible AI host: VS Code Copilot, Claude Desktop, Claude Code, Cursor, Windsurf, and others.

---

## What it does

Once configured, your AI assistant can:

- **Send messages** to your Telegram chat — plain text, formatted Markdown, files
- **Ask questions** and wait for your reply — as free text or button choices
- **Post live status updates** — an in-place checklist that updates as tasks progress
- **Register slash commands** — dynamically set the bot's `/command` menu; commands arrive as structured `{ type: "command", command: "status" }` payloads, no text parsing needed
- **React to messages** — emoji reactions instead of noise text
- **Listen to you** — speak your reply; voice messages are automatically transcribed and arrive as text
- **Talk back** — the agent can reply as a spoken voice note via text-to-speech (local or OpenAI)
- **Send and receive files** — send documents, photos, audio, and video from disk or URL; receive any file type and download on demand
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
        "ALLOWED_USER_ID": "YOUR_USER_ID"
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
        "ALLOWED_USER_ID": "YOUR_USER_ID"
      }
    }
  }
}
```

**Claude Code** — add a **project-scoped** `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/index.js"],
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN",
        "ALLOWED_USER_ID": "YOUR_USER_ID"
      }
    }
  }
}
```

> **Do not add this to global `~/.claude.json`.** Global MCP servers spawn in every Claude Code session — multiple instances will compete for the same bot token's `getUpdates`, causing conflicts.

### 5. Start a session

Paste the contents of `LOOP-PROMPT.md` into your AI assistant's chat. It will connect, announce itself over Telegram, and wait for your instructions.

---

## Tools

### Core — messaging and interaction

| Tool | What it does |
| --- | --- |
| `send_text` | Send a plain or formatted message |
| `send_text_as_voice` | Synthesize text to speech and send as a voice note |
| `notify` | Silent or audible notification with title, body, and severity |
| `ask` | Send a question; blocks until you reply with text or voice |
| `choose` | Send a question with 2–8 labeled buttons; blocks until you tap one or speak a reply. Supports per-button color (`success`/`primary`/`danger`). |
| `confirm` | Yes/No prompt with customizable button colors; blocks until confirmed or denied. |
| `send_new_checklist` | Live in-place checklist — edits itself as steps complete |
| `send_new_progress` | Emoji block progress bar — `▓▓▓▓▓░░░░░ 50%`. Returns `message_id` to track. |
| `update_progress` | Edit an existing progress bar in-place by `message_id`. |
| `show_animation` | Cycling placeholder message visible while the agent works — signals "thinking". Cancel with text to make it a permanent log entry. |
| `dequeue_update` | Wait for the next message, button tap, voice reply, or slash command from the user |

### Messaging utilities

`edit_message_text` · `append_text` · `delete_message` · `pin_message` · `send_file` · `send_chat_action` · `show_typing` · `cancel_animation` · `answer_callback_query` · `get_message`

### Message primitives

`send_message` · `edit_message` · `send_choice`

### Session start

`session_start` — sends intro, checks for pending messages from a previous session, asks the operator to resume or start fresh. Call once at session start.

`get_agent_guide` — loads the behavioral guide. Call once at session start.

### Info & utilities

`get_me` · `get_chat` · `set_reaction` · `set_commands` · `set_topic` · `shutdown`

`set_commands` — registers (or clears) the bot's slash-command menu. Pass `[{command, description}, ...]` to populate Telegram's autocomplete; pass `[]` to remove it. The menu is cleared automatically on shutdown.

`set_topic` — prepends `[Title]` to all outbound messages, e.g. `[Refactor Agent]`. Useful when multiple agents share one chat.

### File operations

`download_file` · `transcribe_voice`

### Session

`session_start` · `dump_session_record`

---

## Agent Instruction Files

Pre-built instruction files are included for common agent hosts:

| File | Host | How it works |
| --- | --- | --- |
| `.github/copilot-instructions.md` | VS Code Copilot / GitHub Copilot | Auto-injected into every session |
| `.github/instructions/telegram-communication.instructions.md` | VS Code Copilot (`applyTo: "**"`) | Auto-injected communication rules |
| `CLAUDE.md` | Claude Code | Auto-read at session start |
| `communication.md` | Any agent | Read explicitly or via MCP resource |

---

## Resources

Five guides are available as MCP resources — any MCP client can read them directly:

| Resource URI | Contents |
| --- | --- |
| `telegram-bridge-mcp://agent-guide` | Behavioral guide for AI assistants |
| `telegram-bridge-mcp://communication-guide` | Telegram communication patterns, tool selection, and loop rules |
| `telegram-bridge-mcp://quick-reference` | Hard rules + tool selection table — compact injected rules card |
| `telegram-bridge-mcp://setup-guide` | Full bot setup walkthrough |
| `telegram-bridge-mcp://formatting-guide` | Markdown/MarkdownV2/HTML reference |

---

## Security

The server enforces a strict single-user model:

- **`ALLOWED_USER_ID`** — Inbound updates from any other user are silently discarded before the assistant ever sees them. Prevents message injection. Also used as the outbound chat target — for private 1-on-1 bots, `chat_id` equals `user_id`.

`chat_id` is never a tool parameter — it is resolved from `ALLOWED_USER_ID` transparently.

See `docs/setup.md` for setup and security details.

---

## Voice Transcription

Voice messages are automatically transcribed by a background poller before they arrive in `dequeue_update`. `ask` and `choose` also handle voice replies inline — results include `voice: true` with the transcribed `text`. Use `transcribe_voice` to re-transcribe a voice message by `file_id` if needed.

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

`send_text_as_voice` synthesizes text to speech and sends it as a Telegram voice note.

Provider is selected automatically from env vars:

| Env var set | Provider |
| --- | --- |
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

### Kokoro Quick Start

The default TTS provider is a local ONNX model — it works with zero config but
produces robotic, single-voice output. **[Kokoro](https://github.com/hexgrad/kokoro)**
is a free, high-quality TTS engine with 25+ natural-sounding voices across
American and British English, male and female. It runs locally via Docker and
exposes an OpenAI-compatible API.

**1. Start the Kokoro server:**

```bash
docker run -d --name kokoro -p 8880:8880 ghcr.io/hexgrad/kokoro-onnx-server:latest
```

**2. Add env vars** to your `.env`:

```dotenv
TTS_HOST=http://localhost:8880
TTS_FORMAT=ogg
TTS_VOICE=af_heart
```

> `TTS_FORMAT=ogg` tells Kokoro to return OGG/Opus directly, skipping the
> local WAV→OGG re-encode step for faster delivery.

**3. Browse and sample voices** — send `/voice` in Telegram to open the
interactive voice panel. It queries your Kokoro server, groups voices by
language and gender, and lets you listen to samples before choosing one.

| Category | Voices |
| --- | --- |
| 🇺🇸 Female | `af_heart` `af_bella` `af_nicole` `af_sarah` `af_sky` |
| 🇺🇸 Male | `am_adam` `am_michael` `am_echo` `am_liam` |
| 🇬🇧 Female | `bf_emma` `bf_isabella` |
| 🇬🇧 Male | `bm_george` `bm_lewis` |

The selected voice is saved to `mcp-config.json` and persists across restarts.

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

```txt
ghcr.io/electricessence/telegram-bridge-mcp:latest
ghcr.io/electricessence/telegram-bridge-mcp:3.0.0
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
        "-v", "telegram-mcp-cache:/home/node/.cache",
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
        "-v", "telegram-mcp-cache:/home/node/.cache",
        "ghcr.io/electricessence/telegram-bridge-mcp:latest"
      ]
    }
  }
}
```

**Claude Code** — `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--env-file", "/absolute/path/to/.env",
        "-v", "telegram-mcp-cache:/home/node/.cache",
        "ghcr.io/electricessence/telegram-bridge-mcp:latest"
      ]
    }
  }
}
```

The `-v telegram-mcp-cache:/home/node/.cache` volume persists downloaded Whisper/TTS model weights across container restarts.

### Image verification

Every published image is signed with [Cosign](https://docs.sigstore.dev/cosign/overview/) via keyless signing (GitHub OIDC). Each image also includes an SBOM and full build provenance attestation generated by the GitHub Actions workflow.

**Verify the signature:**

```sh
cosign verify \
  ghcr.io/electricessence/telegram-bridge-mcp:latest \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  --certificate-identity-regexp="https://github.com/electricessence/Telegram-Bridge-MCP/.github/workflows/publish.yml"
```

**Inspect the SBOM:**

```sh
docker buildx imagetools inspect \
  ghcr.io/electricessence/telegram-bridge-mcp:latest \
  --format '{{json .SBOM}}'
```

**Inspect the provenance:**

```sh
docker buildx imagetools inspect \
  ghcr.io/electricessence/telegram-bridge-mcp:latest \
  --format '{{json .Provenance}}'
```

---

## License

AGPL-3.0-only — see [LICENSE](LICENSE).
