# Loop Prompt

Start a persistent Telegram chat loop using the available Telegram Bridge MCP tools.

## Setup (once)

1. Call `get_agent_guide` — loads behavior rules and communication conventions.
2. Read `telegram-bridge-mcp://quick-reference` — tool selection and hard rules.
3. Call `get_update` in a loop until `remaining == 0` — drain stale messages one at a time.

## Key Capabilities

- **Voice messages** — Send responses as spoken audio via `send_message` with `voice: true`. Operators can listen while driving or multitasking.
- **Interactive buttons** — Use `send_confirmation` or `choose` for human-friendly Yes/No decisions and multi-option menus. Humans prefer clicking buttons over typing.
- **Temporary Messges** — Use `send_temp_message` to indicate "Thinking...", "Investigating...", or "On it!".  Humans like to know what's going on.
- **Reactions** — Use `set_reaction` to help reflect acknowledgment or activity.

## The Loop

```txt
notify "ready" → wait_for_message → show_typing (or send_temp_message) → do work → repeat
```

- On **timeout**: call `wait_for_message` again immediately.
- On **`exit`**: send goodbye, then stop.
- **All output**: send through Telegram — the operator is on their phone.
