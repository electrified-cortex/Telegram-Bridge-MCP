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
|--------|--------------|
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

### VS Code (Copilot / Claude extension)

Add to your `.vscode/mcp.json` (or user settings):

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

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Claude Code

Add a **project-scoped** `.mcp.json` in your project root:

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

> **Do not add this to global `~/.claude.json` `mcpServers`.** Global MCP servers are spawned in *every* Claude Code session. If you have multiple sessions open, each one starts its own Telegram MCP process — all competing for the same bot token's `getUpdates` poll. Only the first instance receives updates; the rest get nothing or cause conflicts. Always use a project-scoped `.mcp.json` so the server only runs in sessions opened from that directory.

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

### `dequeue_update` returns `{ empty: true }` immediately

- If `timeout` is 0 (instant poll) and there are no pending updates, this is expected.
- Use `dequeue_update()` with no arguments to block up to 60 s for the next update.

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
|--------|-------------------|
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
