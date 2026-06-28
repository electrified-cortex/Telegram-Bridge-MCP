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

```txt
Are credentials already configured? (.env or env vars present)
├── YES → skip to "Connect Your Client"
└── NO  → go to "First-Time Setup"

First-Time Setup:
└── Does the user have a Telegram bot token?
    ├── YES → skip to "Configure .env"
    └── NO  → guide them through BotFather (Step 1 in docs/setup.md)

Connect Your Client:
└── What MCP client are you in?
    ├── Claude Code    → add to .mcp.json in project root (HTTP mode)
    ├── VS Code        → add to .vscode/mcp.json (HTTP mode)
    ├── Cursor         → add to .cursor/mcp.json (HTTP mode)
    ├── Claude Desktop → add to claude_desktop_config.json (HTTP mode)
    └── Other / unsure → HTTP mode (see snippets below); stdio as fallback only

Transport mode:
├── HTTP ← USE THIS (works for every client, supports multi-session, no conflicts)
│   → start server once: MCP_PORT=3099 pnpm start (or Docker)
│   → all clients point at http://127.0.0.1:3099/mcp
│   → multiple clients can connect simultaneously — no getUpdates conflicts
└── stdio ← FALLBACK ONLY (use when you cannot run a persistent server)
    → each client spawns its own process — only ONE client at a time
    → multiple stdio instances will fight over getUpdates and miss messages
    → use dist/launcher.js to avoid hardcoding credentials in config
```

---

## First-Time Setup

### Step 1 — Create a Bot

1. Open Telegram → search for **@BotFather** (blue checkmark, official)
2. Send `/newbot` → follow prompts → copy the token
3. Message your new bot once (send any text) — required before it can message you

### Step 2 — Get Your User ID

Visit this URL in a browser (replace `<TOKEN>` with your token):

```txt
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

### Claude Desktop — HTTP mode

Add to `claude_desktop_config.json`:

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

### Stdio mode — launcher (fallback: any client, zero credentials in config)

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

### Stdio mode — direct (last resort: no .env available)

Only use if `.env` files are not available and you cannot run the server. Pass credentials explicitly:

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
2. Call `session_start` — sends an announcement to Telegram and returns an object such as `{ token, sid, pin, sessions_active, action, pending }`. Use the `token` integer from that object as the `token` parameter for all subsequent tool calls.
3. Have the user confirm they see the announcement in Telegram, then store `token` from the result as your identity for all subsequent tool calls.

If `get_me` fails with `401 Unauthorized`: the token is wrong — ask the user to check it.
If `session_start` fails: the server may not be running (HTTP mode) or credentials are missing.

---

## Starting the Loop

After successful verification, paste `LOOP-PROMPT.md` into the chat (or read its contents
and follow the startup sequence). This enters the persistent Telegram event loop.

For detailed troubleshooting and advanced configuration, read `docs/setup.md` or call
the `telegram-bridge-mcp://setup-guide` resource.

---

## Sub-sessions

### Vocabulary

**Sub-session**, **child session**, and **thread** all mean the same thing: a dedicated
session scope created for a focused topic, spawned via `session/spawn-child`. The session
that spawns it is the **host** (or **parent**). The host remains the governor; the child
handles one topic in isolation.

### Host Protocol — What to Do After `session/spawn-child`

```txt
spawn-child returns { token: <child_token>, sid: <child_sid>, ... }
```

**Step 1 — Forward a task brief (MUST, immediate)**

Call `session/forward-child` (`action(type: 'child/forward')`) with the task brief
**before** the child's first dequeue. Without this the child has no context and cannot act:

```
action(type: 'child/forward', token: <host_token>, child_sid: <child_sid>, message: '<task brief>')
```

This is the `session/forward-child` handler — it injects the brief as the child's first
inbound message.

**Step 2 — Dispatch a background sub-agent**

Launch a background sub-agent with the child token returned by `spawn-child`.
The sub-agent's loop:

```
dequeue(token: <child_token>) → handle → repeat until topic resolved
```

Pick a model class appropriate to the topic complexity.

**Step 3 — Monitor for `CHILD_SESSION_RESOLVED`**

When the sub-agent finishes, you receive a `child_session_resolved` event via your
own dequeue. Check `exit_status` to determine whether the topic is fully resolved or
needs follow-up.

**Step 4 — Revoke if the child goes silent (at host's discretion)**

If the child becomes stale or the sub-agent stops responding, the host may revoke it:

```
action(type: 'session/revoke-child', token: <host_token>, child_token: <child_token>)
```

The sub-agent may also self-revoke when it completes the topic.

### Child Arrival — What the Sub-Agent Receives on Connect

On the child session's first `dequeue`, the bridge delivers several orientation messages
automatically:

1. **Token save reminder** — confirms the child token is real; save it for the dispatch.
2. **Role context** — topic name, parent SID, and parent name (advisory; authority is the
   bridge session record, not this message).
3. **Dequeue loop instruction** — `dequeue(token: <child_token>)` is the sub-agent's loop;
   no Monitor or activity-file wiring is needed.
4. **Exit protocol** — when the topic is resolved, emit `EXIT_STATUS: <summary>` then call
   `session/revoke-child(child_token: <child_token>)` to self-despawn.
5. **Task brief** — the message forwarded by the host via `child/forward` arrives in the
   queue; this is the sub-agent's primary instruction.

For the full reference, call `help(topic: 'sub-sessions')` inside an active session.
