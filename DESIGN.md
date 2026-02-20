# Telegram MCP — Design Document

## Overview

A Model Context Protocol (MCP) server that exposes Telegram Bot API actions as MCP tools, allowing AI assistants (e.g. Claude, Copilot) to send and receive messages via a Telegram bot.

---

## Architecture

```
AI Assistant (MCP Client)
        │  MCP over stdio
        ▼
┌─────────────────────┐
│   Telegram MCP      │  (Node.js / TypeScript)
│   @modelcontextprotocol/sdk │
└────────┬────────────┘
         │  HTTPS REST
         ▼
  Telegram Bot API
  api.telegram.org/bot<token>/...
```

The server runs as a **stdio MCP server**, spawned by the MCP host. It holds a Telegram Bot token (via environment variable) and translates MCP tool calls into Telegram Bot API HTTP requests using **`grammy`** — chosen for its complete, always-up-to-date TypeScript-typed Bot API coverage including all keyboard/button types.

Polling is supported as a first-class pattern: the server maintains a persistent `offset` (last seen `update_id + 1`) in memory across calls, so repeated `get_updates` calls naturally advance the queue without re-delivering old messages.

---

## Configuration

| Variable      | Required | Description                        |
|---------------|----------|------------------------------------|
| `BOT_TOKEN`   | Yes      | Telegram Bot API token from @BotFather |

Set via environment variable, or a `.env` file (loaded with `dotenv`).

---

## Tools

### `get_me`
Returns basic information about the bot.

**Input:** _(none)_

**Output:** `{ id, first_name, username, can_join_groups, can_read_all_group_messages }`

---

### `send_message`
Sends a text message to a chat.

**Input:**
| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `chat_id`   | string | Yes      | Target chat/user ID or `@username` |
| `text`      | string | Yes      | Message text |
| `parse_mode`| string | No       | `"HTML"` or `"Markdown"` |

**Output:** Sent message object (id, date, text).

---

### `get_updates`
Retrieves recent incoming messages (polling, one-shot).

**Input:**
| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `offset` | number | No       | Update ID offset (exclusive lower bound) |
| `limit`  | number | No       | Max updates to return (1–100, default 10) |

**Output:** Array of update objects (update_id, message.from, message.chat, message.text, message.date).

---

### `get_chat`
Gets detailed information about a chat.

**Input:**
| Field     | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `chat_id` | string | Yes      | Chat ID or `@username` |

**Output:** Chat object (id, type, title/first_name, username).

---

### `send_photo`
Sends a photo by URL.

**Input:**
| Field     | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `chat_id` | string | Yes      | Target chat ID or `@username` |
| `photo`   | string | Yes      | Public URL of the photo |
| `caption` | string | No       | Optional caption |

**Output:** Sent message object.

---

## Project Structure

```
telegram-mcp/
├── src/
│   ├── index.ts             # Entry point — creates and starts MCP server
│   ├── server.ts            # MCP server definition and tool registration
│   ├── telegram.ts          # grammy Api wrapper + offset state management
│   └── tools/
│       ├── get_me.ts
│       ├── send_message.ts
│       ├── get_updates.ts        # Manages persistent offset for polling
│       ├── answer_callback_query.ts
│       ├── edit_message_text.ts
│       ├── get_chat.ts
│       ├── send_photo.ts
│       ├── forward_message.ts
│       ├── pin_message.ts
│       └── delete_message.ts
├── .env.example
├── package.json
├── tsconfig.json
└── DESIGN.md
```

---

## MCP Server Registration (example `mcp.json`)

```json
{
  "servers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "BOT_TOKEN": "<your-token>"
      }
    }
  }
}
```

---

## Error Handling
- All Telegram API errors are caught and returned as MCP tool errors (non-fatal).
- Missing `BOT_TOKEN` at startup causes an immediate fatal exit with a clear message.
