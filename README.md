# Telegram Bridge MCP

[![CI](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml)
[![Docker](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-telegram--bridge--mcp-blue?logo=docker)](https://github.com/electricessence/Telegram-Bridge-MCP/pkgs/container/telegram-bridge-mcp)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

<img align="right" src="interaction.jpg" width="320" alt="AI agents coordinating through Telegram Bridge MCP">

## No Claw? No Problem.

**Anthropic restricted Claude Code's native instance API** — but this bridge doesn't care. It's a standard MCP server. Any IDE, any model, any agent framework that speaks MCP works out of the box.

## What is this?

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants to Telegram. Send messages, ask questions, receive voice replies, run multiple agent sessions concurrently — all through a single bot.

Works with any MCP client — VS Code, Copilot CLI, Claude Code, Cursor, Windsurf, and any MCP-compatible host. No proprietary lock-in.

## Highlights

- **Two-way messaging** — text, Markdown, files, voice notes
- **Interactive controls** — buttons, confirmations, checklists, progress bars
- **Voice in, voice out** — automatic transcription (Whisper) and TTS (local or OpenAI)
- **Multi-session** — multiple agents share one bot with per-session queues, identity auth, and message routing
- **Reminders** — scheduled events that fire as synthetic messages after a delay
- **Live animations** — cycling status messages while the agent works
- **Slash commands** — dynamic bot menu; commands arrive as structured events
- **No webhooks** — long-polling, no public URL needed

## Supported Platforms

The bridge is a standard MCP server — it works with any MCP-compatible host.

### IDEs & Agent Hosts

| Platform | Transport | Notes |
| --- | --- | --- |
| VS Code (GitHub Copilot Chat) | Streamable HTTP or stdio | Native MCP support |
| Claude Code (CLI) | Streamable HTTP or stdio | |
| Cursor | Streamable HTTP or stdio | |
| Copilot CLI | stdio | |
| Any MCP-compatible client | Streamable HTTP or stdio | If it speaks MCP, it works |

### Transports

| Transport | Entry point | Use case |
| --- | --- | --- |
| **Streamable HTTP** | `pnpm start -- --http` | Multiple clients share one server (recommended) |
| **stdio** | `node dist/index.js` | Single client, no persistent server |
| **Launcher bridge** | `node dist/launcher.js` | Auto-starts HTTP if needed, bridges stdio ↔ HTTP |

---

## Quick Start

Paste this into your AI assistant's chat:

```text
Set me up: https://github.com/electricessence/Telegram-Bridge-MCP
```

<details>
<summary><strong>Manual setup</strong></summary>

1. **Clone & build** — `git clone https://github.com/electricessence/Telegram-Bridge-MCP.git && cd Telegram-Bridge-MCP && pnpm install && pnpm build`
2. **Create a bot** — message @BotFather → `/newbot` → copy the token
3. **Pair** — `pnpm pair` (writes `.env`)
4. **Configure your editor** — see [`docs/setup.md`](docs/setup.md) for per-client snippets (VS Code, Claude Code, Cursor, Docker)

</details>

---

## Tools

Telegram Bridge MCP v6 exposes **4 tools** with type-based routing.

### `send` — Outbound Messaging

| Type | Description |
| --- | --- |
| `text` | Send formatted Markdown text (or TTS voice via `audio` param) |
| `file` | Send a file (photo, document, video, audio, voice) |
| `notification` | Notification with severity (info/success/warning/error) |
| `choice` | Message with inline buttons (non-blocking) |
| `direct` | DM another session (requires `target_sid`) |
| `append` | Append text to an existing message |
| `animation` | Start a cycling status animation |
| `checklist` | Create a pinned live checklist |
| `progress` | Create an emoji progress bar |
| `question` | Blocking question — route with `ask`, `confirm`, or `choose` param |

### `dequeue` — Receive Events

Wait for the next inbound Telegram event (message, button press, voice note, etc.). Supports configurable timeout.

### `help` — Documentation

Discover tool capabilities interactively. Call with optional `topic` for targeted docs.

### `action` — Universal Dispatcher

RESTful path routing via `type` parameter. Supports progressive discovery:

- Omit `type` → list all categories
- Pass a category (e.g. `session`) → list sub-paths
- Pass a full path (e.g. `session/start`) → execute

**Session:** `session/start` · `session/close` · `session/list` · `session/rename`

**Config:** `config/voice` · `config/topic` · `config/commands` · `config/profile/save` · `config/profile/load` · `config/profile/import` · `config/reminder/set` · `config/reminder/cancel` · `config/reminder/list` · `config/dequeue-default` · `config/animation/default` · `config/logging/toggle`

**Message:** `message/edit` · `message/delete` · `message/pin` · `message/react` · `message/acknowledge` · `message/route` · `message/chat-action`

**History:** `history/chat` · `history/message`

**Log** (governor-only): `log/get` · `log/list` · `log/roll` · `log/delete` · `log/debug` · `log/dump`

**Standalone:** `show-typing` · `animation/cancel` · `approve` · `shutdown` · `shutdown/warn` · `transcribe` · `download` · `checklist/update` · `progress/update`

See [`docs/migration-v5-to-v6.md`](docs/migration-v5-to-v6.md) for a complete mapping from v5 tool names.

---

## Multi-Session

Multiple agents can share one bot simultaneously. Each session gets:

- **Identity** — single `token` integer returned by `action(type: "session/start")`, required on every tool call
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

`send(type: "text", audio: "...")` picks a TTS provider automatically:

| Env var | Provider |
| --- | --- |
| `TTS_HOST` | Any OpenAI-compatible `/v1/audio/speech` endpoint |
| `OPENAI_API_KEY` | api.openai.com |
| Neither | Free local ONNX model (zero config) |

**Kokoro** (recommended local TTS) — `docker run -d --name kokoro -p 8880:8880 ghcr.io/hexgrad/kokoro-onnx-server:latest`, then set `TTS_HOST=http://localhost:8880 TTS_FORMAT=ogg TTS_VOICE=af_heart`. 25+ voices — send `/voice` in Telegram to browse and sample.

Per-session voice override: use `action(type: "config/voice")` or `/voice` in Telegram.

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

> **Pairing first:** Create your `.env` file by running `pnpm pair` on a machine with Node.js, or manually create one from `.env.example`. Docker reads it via `--env-file`.

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

## Agent Setup

To keep agents in the Telegram dequeue loop reliably, install the loop guard hook for your host.
See [`docs/agent-setup.md`](docs/agent-setup.md) for VS Code (GitHub Copilot Chat) and Claude Code installation instructions.

---

## License

AGPL-3.0-only — see [LICENSE](LICENSE).
