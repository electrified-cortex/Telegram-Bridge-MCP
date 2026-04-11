# Telegram Bridge MCP

[![CI](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/ci.yml)
[![Docker](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml/badge.svg)](https://github.com/electricessence/Telegram-Bridge-MCP/actions/workflows/publish.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-telegram--bridge--mcp-blue?logo=docker)](https://github.com/electricessence/Telegram-Bridge-MCP/pkgs/container/telegram-bridge-mcp)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

<img align="right" src="interaction.jpg" width="320" alt="AI agents coordinating through Telegram Bridge MCP" />

## No Claw? No Problem.

**Anthropic restricted Claude Code's native instance API** — but this bridge doesn't care. It's a standard [Model Context Protocol](https://modelcontextprotocol.io) server. Any IDE, any model, any agent framework that speaks MCP connects out of the box — no proprietary lock-in, no webhooks, no public URL required.

---

## What Is This?

**Telegram Bridge MCP** connects AI assistants to Telegram bidirectionally. It lets any MCP-compatible client send messages, ask questions, receive voice replies, and run multiple concurrent agent sessions — all through a single bot you control.

**Works with:** VS Code (GitHub Copilot Chat), Claude Code, Cursor, Windsurf, Copilot CLI, and any MCP-compatible host.

---

## Highlights

| Feature | Description |
| --- | --- |
| **Two-way messaging** | Text, Markdown, files, voice notes |
| **Interactive controls** | Inline buttons, confirmations, questions |
| **Super tools** | Self-pinning checklists and emoji progress bars that update in-place |
| **Voice** | Auto-transcription (bundled Whisper ONNX, no ffmpeg) + TTS (local Kokoro, OpenAI, or bundled ONNX) |
| **Multi-session** | Multiple agents share one bot with isolated queues, token auth, and color identity |
| **Animations** | Cycling status frames while your agent works |
| **Reminders** | Scheduled synthetic events delivered via dequeue |
| **Slash commands** | Dynamic bot menu; commands arrive as structured events |
| **No webhooks** | Pure long-polling — no public URL, no reverse proxy |

---

## Quick Start

> **Tip:** If your AI has web access, paste this to get started (requires web access):
>
> ```text
> Set me up: https://github.com/electricessence/Telegram-Bridge-MCP
> ```

<details>
<summary><strong>Manual setup (step by step)</strong></summary>

### 1. Clone and build

```bash
git clone https://github.com/electricessence/Telegram-Bridge-MCP.git
cd Telegram-Bridge-MCP
pnpm install && pnpm build
```

### 2. Create a bot

Message [@BotFather](https://t.me/BotFather) on Telegram:

```text
/newbot
```

Copy the token it gives you.

### 3. Pair interactively

```bash
pnpm pair
```

The wizard prompts for your bot token and Telegram user ID, writes a `.env` file, and verifies connectivity.

### 4. Configure your MCP host

See [`docs/setup.md`](docs/setup.md) for per-client config snippets (VS Code, Claude Code, Cursor, Docker).

</details>

---

## Transports

| Transport | Entry Point | Best For |
| --- | --- | --- |
| **Streamable HTTP** | `pnpm start -- --http` | Multiple clients sharing one server (recommended) |
| **stdio** | `node dist/index.js` | Single client, no persistent server |
| **Launcher bridge** | `node dist/launcher.js` | Auto-starts HTTP if needed, bridges stdio ↔ HTTP |

<details>
<summary><strong>Streamable HTTP MCP config example</strong></summary>

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

</details>

<details>
<summary><strong>stdio MCP config example</strong></summary>

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/path/to/Telegram-Bridge-MCP/dist/index.js"],
      "env": {
        "BOT_TOKEN": "your-token",
        "ALLOWED_USER_ID": "your-user-id"
      }
    }
  }
}
```

</details>

---

## Tools — The v6 API

Version 6 consolidates the entire API into **4 tools** with type-based routing. Call `help(topic?)` at any time for interactive documentation discovery.

### `send` — Outbound Messaging

All outbound operations flow through a single `send` call. The `type` parameter determines behavior.

| Type | Description |
| --- | --- |
| `text` | Formatted Markdown text; pass `audio: "..."` to speak via TTS |
| `file` | Photo, document, video, audio, or voice note |
| `notification` | Status notification with severity: `info` · `success` · `warning` · `error` |
| `choice` | Message with inline buttons (non-blocking) |
| `question` | Blocking prompt — route with `ask`, `confirm`, or `choose` |
| `dm` | DM to another session (`target_sid` or `target` alias); `"direct"` accepted as alias |
| `append` | Append text to an existing message |
| `animation` | Start a cycling status animation |
| `checklist` | Create a self-pinning live checklist; requires `title`, accepts `steps` array of `{label, status}` objects |
| `progress` | Create an emoji progress bar (width configurable) |

> Update in-place with `action(type: "checklist/update", message_id: ...)` and `action(type: "progress/update", message_id: ...)` respectively. See [`docs/super-tools.md`](docs/super-tools.md).

```js
// Examples — token required for all session-scoped calls; session/start and most help topics work without a token
// token: 1234567 (required for all session-scoped calls)
send({ token: 1234567, type: "text", text: "Hello from your AI agent!" })
send({ token: 1234567, type: "notification", severity: "success", text: "Build passed." })
send({ token: 1234567, type: "question", ask: "Proceed with deployment?" })
send({ token: 1234567, type: "checklist", title: "Pipeline", steps: [{ label: "Design", status: "pending" }, { label: "Implement", status: "pending" }, { label: "Review", status: "pending" }, { label: "Deploy", status: "pending" }] })
send({ token: 1234567, type: "progress", title: "Processing files", percent: 40, subtext: "4 of 10 complete", width: 10 })
```

### `dequeue` — Receive Inbound Events

Long-poll for the next inbound event: messages, button presses, voice notes, slash commands, reminders.

> **Note:** `token` is the integer returned by `action(type: "session/start")`.

```js
dequeue({ token: 1234567 })              // default timeout — idles until event
dequeue({ token: 1234567, timeout: 0 }) // non-blocking drain (coordination gates)
```

### `action` — Universal Dispatcher

RESTful path routing via `type`. Supports progressive discovery:

- Omit `type` → list all categories
- Pass a category → list sub-paths
- Pass a full path → execute

<details>
<summary><strong>Full action reference</strong></summary>

#### Session
`session/start` · `session/close` · `session/list` · `session/rename`

#### Profile
`profile/voice` · `profile/topic` · `profile/save` · `profile/load` · `profile/import` · `profile/dequeue-default`

#### Reminder
`reminder/set` · `reminder/cancel` · `reminder/list`

#### Animation
`animation/default` · `animation/cancel`

#### Message
`message/edit` · `message/delete` · `message/pin` · `message/route` · `message/history` · `message/get`

#### Chat
`chat/info`

#### Super Tools
`checklist/update` · `progress/update`

#### Confirm Presets
`confirm/ok` · `confirm/ok-cancel` · `confirm/yn`

#### Standalone
`react` · `acknowledge` · `show-typing` · `commands/set` · `logging/toggle` · `transcribe` · `download`

#### Governor-only
`approve` · `shutdown` · `shutdown/warn` · `log/get` · `log/list` · `log/roll` · `log/delete` · `log/debug`

</details>

### `help` — Documentation Discovery

```js
help()                    // list all topics
help({ topic: "send" })  // targeted reference for a specific tool or type
```

---

## Multi-Session

Multiple agents can share one bot simultaneously without cross-talk.

```text
session/start → token (integer) → pass on every call
```

**Token format:** `token = sid * 1_000_000 + pin` — a single integer, returned by `action(type: "session/start")`.

| Capability | Description |
| --- | --- |
| **Isolated queues** | Per-session routing; no messages bleed between agents |
| **Color identity** | Outbound messages prefixed with color + name (e.g., `🟩 Worker 1`) |
| **Governor model** | First session is primary; additional sessions require operator approval via color-picker keyboard |
| **DMs** | Inter-session messaging via `send(type: "dm", target_sid: N, ...)` (alias: `"direct"`; `target_sid` alias: `target`) |
| **Health monitoring** | Unresponsive sessions trigger operator prompts to reroute or promote |
| **Graceful teardown** | Orphaned events rerouted; callback hooks replaced on close |

See [`docs/multi-session-protocol.md`](docs/multi-session-protocol.md) for the full routing protocol.

---

## Voice

### Transcription (Inbound)

Voice messages are auto-transcribed before delivery. No external API, no ffmpeg required — the Whisper ONNX model is bundled.

```env
WHISPER_MODEL=onnx-community/whisper-base   # default
WHISPER_CACHE_DIR=/path/to/cache            # optional
```

### Text-to-Speech (Outbound)

Triggered by `send(type: "text", audio: "...")`. Provider is selected automatically:

| Environment Variable | Provider |
| --- | --- |
| `TTS_HOST` | Any OpenAI-compatible `/v1/audio/speech` endpoint |
| `OPENAI_API_KEY` | api.openai.com |
| Neither set | Bundled ONNX model (zero config) |

#### Kokoro (recommended local TTS)

High-quality local TTS with 25+ voices. No API key, no cost.

```bash
docker run -d --name kokoro -p 8880:8880 ghcr.io/hexgrad/kokoro-onnx-server:latest
```

```env
TTS_HOST=http://localhost:8880
TTS_FORMAT=ogg
TTS_VOICE=af_heart
```

Send `/voice` in Telegram to browse and sample voices live.

Per-session voice override: `action(type: "profile/voice")` or `/voice` in Telegram.

---

## MCP Resources

Five resources are available to any connected client — no tool call required:

| URI | Contents |
| --- | --- |
| `telegram-bridge-mcp://agent-guide` | Behavioral guide for AI agents |
| `telegram-bridge-mcp://communication-guide` | Communication patterns and loop rules |
| `telegram-bridge-mcp://quick-reference` | Hard rules + compact tool table |
| `telegram-bridge-mcp://setup-guide` | Setup walkthrough |
| `telegram-bridge-mcp://formatting-guide` | Markdown / MarkdownV2 / HTML reference |

---

## Docker

```text
ghcr.io/electricessence/telegram-bridge-mcp:latest
```

> **Before running Docker:** Create your `.env` file first by running `pnpm pair` on a machine with Node.js, or copy `.env.example` and fill it in manually.

**Streamable HTTP (recommended)** — run as a long-lived service:

```bash
docker run -d --name telegram-mcp \
  --env-file /absolute/path/to/.env \
  -e MCP_PORT=3099 \
  -p 3099:3099 \
  -v telegram-mcp-cache:/home/node/.cache \
  ghcr.io/electricessence/telegram-bridge-mcp:latest
```

Connect MCP hosts to `http://127.0.0.1:3099/mcp`.

<details>
<summary><strong>stdio mode</strong> (per-host process, no persistent server)</summary>

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

The cache volume persists Whisper and TTS model weights across container restarts.

---

## Development

```bash
pnpm build      # Compile TypeScript
pnpm dev        # Watch mode
pnpm test       # Run tests
pnpm coverage   # Coverage report
pnpm pair       # Re-run pairing wizard
```

---

## Agent Setup

To keep agents reliably in the Telegram dequeue loop, install the loop-guard hook for your host. The hook prevents agents from dropping out of the loop on idle or forced stop.

See [`docs/agent-setup.md`](docs/agent-setup.md) for installation instructions for VS Code (GitHub Copilot Chat) and Claude Code.

---

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/setup.md`](docs/setup.md) | Full setup walkthrough with per-client config |
| [`docs/multi-session-protocol.md`](docs/multi-session-protocol.md) | Multi-session routing and governor model |
| [`docs/super-tools.md`](docs/super-tools.md) | Checklist and progress bar reference |
| [`docs/agent-setup.md`](docs/agent-setup.md) | Loop-guard hooks for VS Code and Claude Code |
| [`docs/migration-v5-to-v6.md`](docs/migration-v5-to-v6.md) | v5 → v6 tool name mapping |
| [`docs/git-index-safety.md`](docs/git-index-safety.md) | Git index safety notes for multi-agent environments |

---

## License

[AGPL-3.0-only](LICENSE)
