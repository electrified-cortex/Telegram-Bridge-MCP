# Telegram Bridge MCP — Setup Guide

This guide walks you through creating a Telegram bot and configuring it for use with Telegram Bridge MCP.
An AI assistant can read this resource (`telegram-bridge-mcp://setup-guide`) and walk you through setup step-by-step.

---

## Security Model

> **This section is not optional.** An unsecured bot token is a public endpoint — anyone who finds your bot can message it and inject responses into the agent's decision stream.

The server enforces security at two independent layers:

### Layer 1 — Inbound: `ALLOWED_USER_ID`

Your numeric Telegram user ID. When set:

- Every update (message, button press) is checked against this ID **before** it is returned to the agent.
- Updates from any other sender are **silently consumed and discarded** — they advance the offset so the queue stays clean, but the agent never sees them.
- Without this, a second person messaging your bot could feed the agent arbitrary responses.

### Threat model summary

| Threat | Mitigated by |
| --- | --- |
| Stranger messages bot to inject replies | `ALLOWED_USER_ID` |
| Agent redirected to message a different chat | No `chat_id` parameter — target is always `ALLOWED_USER_ID` |
| Token leak → someone sends messages as bot | Rotate via `/revoke` in BotFather |
| Token in version control | `.env` is git-ignored; never put it in config files |

**Startup behaviour:** If `ALLOWED_USER_ID` is not set the server starts but emits a warning to stderr. Set it before using the bot in any real workflow.

---

## Step 1 — Create a Bot with BotFather

1. Open Telegram and search for **@BotFather** (official, has a blue checkmark).
2. Send `/newbot`.
3. When prompted, enter a **display name** (e.g. `My Coding Assistant`).
4. Enter a **username** — must end in `bot` (e.g. `mycodingassistant_bot`).
5. BotFather replies with your **HTTP API token** — a string like:

   ```text
   123456789:AABBCCDDEEFFaabbccddeeff-1234567890
   ```

   Copy it. Treat it like a password — never commit it to git.

---

## Step 2 — Set the BOT_TOKEN

Copy `.env.example` to `.env` in the project root (already git-ignored), then fill in your values:

```env
BOT_TOKEN=123456789:AABBCCDDEEFFaabbccddeeff-1234567890

# Strongly recommended — see Security Model above
ALLOWED_USER_ID=<your numeric user ID>
```

Or pass both as environment variables in your MCP host config (see Step 5).

---

## Step 3 — Find Your User ID

The bot needs your numeric Telegram user ID for `ALLOWED_USER_ID`. For private 1-on-1 bots, your chat ID equals your user ID — no separate config needed.

1. Search for your bot by @username in Telegram and start a chat.
2. Send any message (e.g. `/start`).
3. In a browser, open:

   ```text
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```

4. In the JSON response, find:

   ```json
   {
     "message": {
       "from": { "id": 123456789 }
     }
   }
   ```

   `message.from.id` → your **user ID** → use as `ALLOWED_USER_ID`.

> **Tip:** `pnpm pair` automates this step — it polls for the pairing code and writes `ALLOWED_USER_ID` to `.env` automatically.

---

## Step 4 — Verify the Token Works

Use the `get_me` MCP tool. It should return the bot's username and ID.
If you get a `401 Unauthorized` error, the token is wrong — regenerate it with `/revoke` in BotFather.

---

## Step 5 — MCP Host Configuration

### Streamable HTTP (recommended)

Run **one** server instance and connect any number of editors or Claude Code sessions. Each client gets its own MCP session with an isolated queue — no `getUpdates` conflicts.

**1. Start the server** (terminal, tmux, startup script, etc.):

```bash
MCP_PORT=3099 pnpm start
```

All config comes from `.env` — no credentials in your editor settings.

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

**Claude Code** (`.mcp.json`):

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

**Claude Desktop** (`claude_desktop_config.json`): same shape as Claude Code.

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

> **Do not add to global `~/.claude.json` `mcpServers`.** Global servers spawn in *every* session, generating noise and competing for the same bot.

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
      "cwd": "/path/to/telegram-bridge-mcp",
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN_HERE",
        "ALLOWED_USER_ID": "123456789"
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/index.js"],
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN_HERE",
        "ALLOWED_USER_ID": "123456789"
      }
    }
  }
}
```

**Claude Code** (`.mcp.json`): same shape as Claude Desktop.

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/telegram-bridge-mcp/dist/index.js"],
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN_HERE",
        "ALLOWED_USER_ID": "123456789"
      }
    }
  }
}
```

A `dist/launcher.js` convenience script is also available — it auto-starts the HTTP server if none is running, then bridges stdio ↔ HTTP. This lets you use a stdio config while still benefiting from a shared server.

**Launcher bridge** (auto-starts the HTTP server):
Instead of starting the server manually, use `dist/launcher.js` as a drop-in stdio replacement. It auto-starts the HTTP server on first use and bridges stdin/stdout ↔ HTTP for all subsequent connections. Credentials come from `.env` — no need to duplicate them in editor config.

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

**Claude Desktop** (`claude_desktop_config.json`) / **Claude Code** (`.mcp.json`):

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

---

## Voice Configuration

### Transcription (inbound)

Voice messages are auto-transcribed before delivery using a bundled ONNX Whisper model. No external API or ffmpeg required.

```env
WHISPER_MODEL=onnx-community/whisper-base   # default; swap for a larger model for better accuracy
WHISPER_CACHE_DIR=/path/to/cache            # optional — cache model files here
```

### Text-to-Speech (outbound)

`send_text_as_voice` picks a TTS provider in priority order:

| Priority | Env var | Provider |
| --- | --- | --- |
| 1 | `TTS_HOST` | Any OpenAI-compatible `/v1/audio/speech` endpoint (Kokoro, Ollama, etc.) |
| 2 | `OPENAI_API_KEY` | api.openai.com |
| 3 | *(neither)* | Bundled ONNX model — zero config, lower quality |

**Kokoro is the recommended local TTS option** — high-quality output, 25+ voices, runs in Docker with no API key.

```bash
docker run -d --name kokoro -p 8880:8880 ghcr.io/hexgrad/kokoro-onnx-server:latest
```

```env
TTS_HOST=http://localhost:8880
TTS_FORMAT=ogg
TTS_VOICE=af_heart      # default voice; send /voice in Telegram to browse all 25+
```

Kokoro voices follow a `{prefix}_{name}` pattern — `af_` (American female), `am_` (American male), `bf_` (British female), `bm_` (British male). Examples: `af_heart`, `am_onyx`, `bf_emma`, `am_michael`.

Send `/voice` in your Telegram chat to browse and preview all available voices interactively.

### Per-Session Voice Override

Agents can set a per-session TTS voice with the `set_voice` MCP tool, overriding the global default without affecting other sessions. Pass an empty string to clear the override and revert to the global default.

---

## Troubleshooting

### "BOT_TOKEN environment variable is not set"

- The server started without a token. Check the `env` block in your MCP config or that `.env` exists.

### `UNAUTHORIZED_SENDER`

- An inbound update arrived from a user who is not `ALLOWED_USER_ID`.
- This is the security filter working correctly — no action needed.
- If you sent the message yourself and still see this, `ALLOWED_USER_ID` is set to the wrong value. Re-check it against `message.from.id` in `getUpdates`.

### `UNAUTHORIZED_CHAT`

- `ALLOWED_USER_ID` is not configured. Set it in your `.env` or MCP host config.

### `CHAT_NOT_FOUND`

- The `chat_id` is wrong, or the bot has never been added to that chat.
- For DMs: you must message the bot first (Telegram requires users to initiate).
- For groups: the bot must be a member.

### `BOT_BLOCKED`

- The user has blocked the bot. They must unblock it in Telegram settings, or use `/start` again.

### `NOT_ENOUGH_RIGHTS`

- The bot needs admin rights for pin/delete operations.
- In the group: Telegram → Group info → Administrators → Add the bot as admin.

### `PARSE_MODE_INVALID`

- HTML parse mode: ensure all tags are properly closed (`<b>bold</b>`, not `<b>bold`).
- MarkdownV2: these characters must be escaped with `\`: `. ! - = ( ) [ ] { } ~ # > + |`

### `RATE_LIMITED` (retry_after in response)

- Telegram limits bots to ~30 messages/second globally, ~1 message/second per chat.
- The error includes `retry_after` — wait that many seconds before retrying.

### `MESSAGE_CANT_BE_EDITED`

- Messages can only be edited within 48 hours of sending.
- Only the bot's own messages can be edited.

### `send_new_checklist` shows no change

- Telegram silently ignores edits where the text is identical to the current content.
- This is not an error — the message is already up to date.

### `dequeue` returns `{ empty: true }` or `{ timed_out: true }` with no updates

- `{ empty: true }` — expected when `timeout` is 0 (instant poll) and there are no pending updates.
- `{ timed_out: true }` — expected when a blocking wait (default 300 s) expires with no updates. Call again immediately.
- Use `dequeue()` with no arguments to block up to 300 s for the next update.

### Multiple instances competing / messages arriving in wrong session

- Only one process can poll `getUpdates` per bot token. If multiple MCP instances share the same token, they race for updates — most sessions receive nothing.
- **Common cause:** the Telegram MCP server is configured globally (e.g. `~/.claude.json` `mcpServers` for Claude Code, or Claude Desktop's global config) and multiple sessions are open.
- **Fix:** move the config to a project-scoped file (`.mcp.json` for Claude Code, `.vscode/mcp.json` for VS Code) so the server only runs in one session at a time.

### Bot receives its own messages

- This doesn't happen by default. Bots do not receive updates for messages they sent.

### Webhook conflict error

- If you previously set a webhook on this token, `getUpdates` will fail.
- Clear it by calling:

  ```text
  https://api.telegram.org/bot<TOKEN>/deleteWebhook
  ```

---

## Bot Permissions Reference

| Action | Permission needed |
| --- | --- |
| Send messages to a group | Must be a member |
| Read group messages | Must be a member, or have `can_read_all_group_messages` set by BotFather |
| Delete messages | Admin with "Delete messages" right |
| Pin messages | Admin with "Pin messages" right |
| Get chat member info | Admin or member |

---

## Quick Test Sequence (for agent validation)

```text
1. get_me                         → confirm bot identity
2. notify (chat_id, "MCP Online") → confirm message delivery
3. choose (chat_id, "Test?", [{label:"OK", value:"ok"}]) → confirm interactivity
```

If all three succeed, the integration is working correctly.
