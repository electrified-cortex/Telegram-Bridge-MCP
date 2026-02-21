# Telegram Bridge MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants to a Telegram bot — enabling two-way messaging, interactive confirmations, live status updates, and automatic voice transcription.

Works with any MCP-compatible AI host: VS Code Copilot, Claude Desktop, and others.

---

## What it does

Once configured, your AI assistant can:

- **Send messages** to your Telegram chat — plain text, formatted Markdown, photos
- **Ask questions** and wait for your reply — as free text or button choices
- **Post live status updates** — an in-place checklist that updates as tasks progress
- **React to messages** — emoji reactions instead of noise text
- **Transcribe voice messages** — speak your reply; it arrives as text
- **Receive all of this in real time** — long-polling, no webhooks, no public URL needed

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/telegram-bridge-mcp.git
cd telegram-bridge-mcp
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
|------|-------------|
| `get_agent_guide` | Loads the behavioral guide — call this at session start |
| `notify` | Silent or audible notification with title, body, and severity |
| `ask` | Sends a question; blocks until you reply with text |
| `choose` | Sends a question with buttons; blocks until you tap one |
| `send_confirmation` | Yes/No prompt wired to `wait_for_callback_query` |
| `update_status` | Live in-place checklist — updates as steps complete |

### Messaging

`send_message` · `edit_message_text` · `forward_message` · `delete_message` · `pin_message` · `send_chat_action` · `start_typing`

### Interaction primitives

`wait_for_message` · `wait_for_callback_query` · `answer_callback_query`

### Info & utilities

`get_me` · `get_chat` · `set_reaction` · `get_updates` · `restart_server`

---

## Resources

Three guides are available as MCP resources — any MCP client can read them directly:

| Resource URI | Contents |
|---|---|
| `telegram-bridge-mcp://agent-guide` | Behavioral guide for AI assistants |
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

All message-receiving tools (`wait_for_message`, `ask`, `choose`, `get_updates`) automatically transcribe voice messages using a local [Whisper](https://github.com/openai/whisper) model via `@huggingface/transformers` (ONNX Runtime).

- No external API calls
- No ffmpeg required
- Model weights are downloaded once on first use and cached locally

Configure via environment variables:

```env
WHISPER_MODEL=onnx-community/whisper-base   # default
WHISPER_CACHE_DIR=/path/to/cache            # optional
```

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

## License

MIT — see [LICENSE](LICENSE).
