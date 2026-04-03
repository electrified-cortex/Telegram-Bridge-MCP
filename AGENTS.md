# Telegram Bridge MCP — Agent Onboarding Guide

This file is for AI agents. When a user says "set me up", "get this working", or
"help me configure Telegram", read this file and follow the decision tree below.

---

## What This MCP Does

Telegram Bridge MCP connects your AI session to a Telegram bot. Once configured, you
can send messages, ask questions, receive voice replies, and run multi-agent sessions —
all through the user's Telegram app.

---

## Quick Decision Tree

```
Are credentials already configured? (.env or env vars present)
├── YES → skip to "Connect Your Client"
└── NO  → go to "First-Time Setup"

First-Time Setup:
└── Does the user have a Telegram bot token?
    ├── YES → skip to "Configure .env"
    └── NO  → guide them through BotFather (Step 1 in docs/setup.md)

Connect Your Client:
└── What MCP client are you in?
    ├── Claude Code  → add to .mcp.json in project root (HTTP mode)
    ├── VS Code      → add to .vscode/mcp.json (HTTP mode)
    ├── Cursor       → add to .cursor/mcp.json (HTTP mode)
    ├── Claude Desktop → add to claude_desktop_config.json (stdio mode)
    └── Other / unsure → use stdio mode with dist/launcher.js (zero extra config)

Transport mode:
├── HTTP (recommended for most users)
│   → start server once: MCP_PORT=3099 pnpm start (or Docker)
│   → all clients point at http://127.0.0.1:3099/mcp
│   → multiple clients can connect simultaneously
└── stdio (simpler, single client only)
    → no separate server process needed
    → each client spawns its own process
    → only one client at a time — multiple will conflict
```

---

## First-Time Setup

### Step 1 — Create a Bot

1. Open Telegram → search for **@BotFather** (blue checkmark, official)
2. Send `/newbot` → follow prompts → copy the token
3. Message your new bot once (send any text) — required before it can message you

### Step 2 — Get Your User ID

Visit this URL in a browser (replace `<TOKEN>` with your token):
```
https://api.telegram.org/bot<TOKEN>/getUpdates
```
Look for `message.from.id` in the JSON — that's your `ALLOWED_USER_ID`.

**Shortcut:** `pnpm pair` automates both steps — run it, send the pairing code to your bot,
and it writes `.env` for you.

### Step 3 — Configure .env

```env
BOT_TOKEN=123456789:AABBCCDDEEFFaabbccddeeff-1234567890
ALLOWED_USER_ID=123456789
```

Copy `.env.example` to `.env` and fill in these two values.

---

## Client Configuration Snippets

### Claude Code — HTTP mode (recommended)

Add to `.mcp.json` in your **project root** (not global config):

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

Start server first: `MCP_PORT=3099 pnpm start`

> **Do not** add to global `~/.claude.json`. Every Claude Code session would connect.

### VS Code Copilot — HTTP mode

Add to `.vscode/mcp.json`:

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

### Cursor — HTTP mode

Add to `.cursor/mcp.json` in your project root:

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

### Stdio mode — launcher (any client, zero credentials in config)

Uses `dist/launcher.js` which reads credentials from `.env` and auto-starts the HTTP
server. No credentials needed in your editor config.

**Claude Code** (`.mcp.json`):

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

### Stdio mode — direct (requires credentials in config)

Only use if `.env` files are not available. Pass credentials explicitly:

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

---

## Verification

After configuration, verify the connection:

1. Call `get_me` — should return the bot's username and ID
2. Call `session_start` — sends an announcement to Telegram and returns `[sid, pin]`
3. Have the user confirm they see the announcement in Telegram

If `get_me` fails with `401 Unauthorized`: the token is wrong — ask the user to check it.
If `session_start` fails: the server may not be running (HTTP mode) or credentials are missing.

---

## Starting the Loop

After successful verification, paste `LOOP-PROMPT.md` into the chat (or read its contents
and follow the startup sequence). This enters the persistent Telegram event loop.

For detailed troubleshooting and advanced configuration, read `docs/setup.md` or call
the `telegram-bridge-mcp://setup-guide` resource.
