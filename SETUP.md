# Telegram Bot Setup Guide for Coding Agents

This guide helps you configure a Telegram bot for use with the Telegram MCP server.
A coding agent can read this resource and walk users through setup step-by-step.

---

## Step 1 — Create a Bot with BotFather

1. Open Telegram and search for **@BotFather** (official, has a blue checkmark).
2. Send `/newbot`.
3. When prompted, enter a **display name** (e.g. `My Coding Assistant`).
4. Enter a **username** — must end in `bot` (e.g. `mycodingassistant_bot`).
5. BotFather replies with your **HTTP API token** — a string like:
   ```
   123456789:AABBCCDDEEFFaabbccddeeff-1234567890
   ```
   Copy it. Treat it like a password — never commit it to git.

---

## Step 2 — Set the BOT_TOKEN

Create a `.env` file in the project root (already git-ignored):

```
BOT_TOKEN=123456789:AABBCCDDEEFFaabbccddeeff-1234567890
```

Or pass it as an environment variable in your MCP host config (see Step 5).

---

## Step 3 — Find Your Chat ID

The bot can only message chats it knows about. There are two ways:

### Option A — Message the bot first (DM)
1. Search for your bot by @username in Telegram and start a chat.
2. Send any message (e.g. `/start`).
3. In a browser, open:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
4. Look for `"chat":{"id":` — that number is your personal chat ID.
   It will be a positive integer for DMs, e.g. `123456789`.

### Option B — Add the bot to a group
1. Add the bot to any group.
2. Send a message in the group.
3. Call `getUpdates` as above — group chat IDs are negative, e.g. `-1001234567890`.

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
      "cwd": "/path/to/telegram-mcp",
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN_HERE"
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
      "args": ["/absolute/path/to/telegram-mcp/dist/index.js"],
      "env": {
        "BOT_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
```

---

## Troubleshooting

### "BOT_TOKEN environment variable is not set"
- The server started without a token. Check the `env` block in your MCP config or that `.env` exists.

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

### `update_status` shows no change
- Telegram silently ignores edits where the text is identical to the current content.
- This is not an error — the message is already up to date.

### Long-polling (`get_updates`, `wait_for_*`) returns empty immediately
- If `timeout` is 0 (short poll) and there are no pending updates, this is expected.
- Increase `timeout_seconds` to up to 55 for true long-polling.

### Bot receives its own messages
- This doesn't happen by default. Bots do not receive updates for messages they sent.

### Webhook conflict error
- If you previously set a webhook on this token, `getUpdates` will fail.
- Clear it by calling:
  ```
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

```
1. get_me                         → confirm bot identity
2. notify (chat_id, "MCP Online") → confirm message delivery
3. choose (chat_id, "Test?", [{label:"OK", value:"ok"}]) → confirm interactivity
```

If all three succeed, the integration is working correctly.
